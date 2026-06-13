#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <sys/socket.h>
#include <sys/select.h>
#include <sys/time.h>
#include <netinet/in.h>
#include <arpa/inet.h>
#include <time.h>
#include <signal.h>

#define SERVER_IP "47.253.201.85"
#define MQTT_PORT 18883
#define CMD_PORT 19999
// 运行设备唯一 ID 和助记名称
char g_device_id[64];
char g_device_alias[64];

void init_device_id() {
    // 读取 hostname，格式如 "NFT-2ac-17A42C"
    FILE* fp = popen("hostname 2>/dev/null || echo edgeclaw-unknown", "r");
    if (fp) {
        if (fgets(g_device_alias, sizeof(g_device_alias), fp)) {
            int len = strlen(g_device_alias);
            if (len > 0 && g_device_alias[len-1] == '\n') g_device_alias[len-1] = 0;
        }
        pclose(fp);
    } else {
        snprintf(g_device_alias, sizeof(g_device_alias), "edgeclaw-unknown");
    }
    
    // 设备 ID = hostname 的最后一段（MAC 后缀），保证唯一
    char* dash = strrchr(g_device_alias, '-');
    if (dash && strlen(dash) > 1) {
        snprintf(g_device_id, sizeof(g_device_id), "ec-%s", dash + 1);
    } else {
        snprintf(g_device_id, sizeof(g_device_id), "ec-%s", g_device_alias);
    }
}
#define TOPIC "edgeclaw/ligowave/status"
#define RECONNECT_DELAY 3

// ===================== MQTT =====================
int mqtt_connect(int sock) {
    unsigned char buf[128]; int len = 0;
    buf[len++] = 0x10; buf[len++] = 0;
    buf[len++] = 0x00; buf[len++] = 0x04;
    buf[len++] = 'M'; buf[len++] = 'Q'; buf[len++] = 'T'; buf[len++] = 'T';
    buf[len++] = 0x04; buf[len++] = 0x02;
    buf[len++] = 0x00; buf[len++] = 0x3C;
    int id_len = strlen(g_device_id);
    buf[len++] = 0; buf[len++] = id_len;
    memcpy(buf + len, g_device_id, id_len); len += id_len;
    buf[1] = len - 2;
    return write(sock, buf, len);
}

int mqtt_publish(int sock, const char* payload) {
    unsigned char buf[256]; int len = 0;
    int t_len = strlen(TOPIC), p_len = strlen(payload);
    buf[len++] = 0x30; buf[len++] = 2 + t_len + p_len;
    buf[len++] = 0; buf[len++] = t_len;
    memcpy(buf + len, TOPIC, t_len); len += t_len;
    memcpy(buf + len, payload, p_len); len += p_len;
    return write(sock, buf, len);
}

// ===================== 带重试的连接 =====================
int connect_to(int port) {
    struct sockaddr_in addr;
    int sock = socket(AF_INET, SOCK_STREAM, 0);
    if (sock < 0) return -1;
    addr.sin_family = AF_INET;
    addr.sin_port = htons(port);
    inet_pton(AF_INET, SERVER_IP, &addr.sin_addr);
    if (connect(sock, (struct sockaddr*)&addr, sizeof(addr)) < 0) {
        close(sock);
        return -1;
    }
    return sock;
}

int try_connect(int port) {
    for (int i = 0; i < 5; i++) {  // 重试 5 次
        int sock = connect_to(port);
        if (sock >= 0) return sock;
        sleep(RECONNECT_DELAY);
    }
    return -1;
}

// ===================== 指令执行（结果回传服务器） =====================
void execute_cmd(const char* cmd, int result_sock) {
    char result[4096];
    int pos = 0;
    pos += snprintf(result + pos, sizeof(result) - pos, "=== [CMD] %s ===\n", cmd);

    if (strcmp(cmd, "net_status") == 0) {
        FILE* fp = popen("ifconfig", "r");
        if (fp) {
            char line[256];
            while (fgets(line, sizeof(line), fp)) {
                int len = strlen(line);
                if (pos + len < (int)sizeof(result) - 10) {
                    memcpy(result + pos, line, len);
                    pos += len;
                }
            }
            pclose(fp);
        }
    }
    else if (strcmp(cmd, "refresh_load") == 0) {
        FILE* f = fopen("/proc/loadavg", "r");
        if (f) {
            char load[64];
            if (fgets(load, 64, f)) {
                int len = strlen(load);
                memcpy(result + pos, load, len);
                pos += len;
            }
            fclose(f);
        }
    }
    else if (strcmp(cmd, "ping") == 0) {
        pos += snprintf(result + pos, sizeof(result) - pos, "pong\n");
    }
    else if (strcmp(cmd, "scan_wifi") == 0) {
        FILE* fp = popen("iwinfo", "r");
        if (fp) {
            char line[256];
            while (fgets(line, sizeof(line), fp)) {
                int len = strlen(line);
                if (pos + len < (int)sizeof(result) - 10) {
                    memcpy(result + pos, line, len);
                    pos += len;
                }
            }
            pclose(fp);
        }
    }
    else if (strcmp(cmd, "sys_info") == 0) {
        // cpuinfo + version + uptime + mem
        FILE* fp = popen("cat /proc/cpuinfo && echo '---' && cat /proc/version && echo '---' && uptime && echo '---' && free -m", "r");
        if (fp) {
            char line[256];
            while (fgets(line, sizeof(line), fp)) {
                int len = strlen(line);
                if (pos + len < (int)sizeof(result) - 10) {
                    memcpy(result + pos, line, len);
                    pos += len;
                }
            }
            pclose(fp);
        }
    }
    else if (strcmp(cmd, "signal_quality") == 0) {
        FILE* fp = popen("iwconfig ath0 2>/dev/null | grep -E 'Link Quality|Signal|Noise|ESSID' && echo '---' && iwconfig ath1 2>/dev/null | grep -E 'Link Quality|Signal|Noise|ESSID'", "r");
        if (fp) {
            char line[256];
            while (fgets(line, sizeof(line), fp)) {
                int len = strlen(line);
                if (pos + len < (int)sizeof(result) - 10) {
                    memcpy(result + pos, line, len);
                    pos += len;
                }
            }
            pclose(fp);
        }
    }
    else if (strcmp(cmd, "reboot") == 0) {
        pos += snprintf(result + pos, sizeof(result) - pos, "[Rebooting...]\n");
        write(result_sock, result, pos);
        system("reboot");
        return;
    }
    else {
        pos += snprintf(result + pos, sizeof(result) - pos, "Unknown command: %s\n", cmd);
    }

    // 结果回传服务器
    if (pos > 0 && result_sock >= 0) {
        write(result_sock, result, pos);
        printf("\n🎮 [CMD] '%s' → sent %d bytes back\n", cmd, pos);
    }
}

// ===================== drain MQTT =====================
void drain_mqtt(int mqtt_sock) {
    fd_set dfds; FD_ZERO(&dfds); FD_SET(mqtt_sock, &dfds);
    struct timeval dtv; dtv.tv_sec = 0; dtv.tv_usec = 5000;
    while (select(mqtt_sock + 1, &dfds, NULL, NULL, &dtv) > 0) {
        char drain[32];
        if (read(mqtt_sock, drain, sizeof(drain)) <= 0) break;
    }
}

// ===================== main =====================
int main() {
    // 忽略 SIGPIPE（避免 write 到关闭的 socket 时崩溃）
    signal(SIGPIPE, SIG_IGN);

    init_device_id();
    printf("⭐ EdgeClaw v4 (select-multiplex)\n");
    printf("  Device: [%s] (%s)\n", g_device_id, g_device_alias);
    printf("  MQTT: %d  |  CMD: %d\n", MQTT_PORT, CMD_PORT);

    int mqtt_sock = -1, cmd_sock = -1;

    // 主循环（外部重连循环）
    while (1) {
        // ==== 重连阶段 ====
        if (mqtt_sock < 0) {
            printf("[MQTT] Connecting...\n");
            mqtt_sock = connect_to(MQTT_PORT);
            if (mqtt_sock >= 0) {
                mqtt_connect(mqtt_sock);
                printf("[MQTT] Connected ✅\n");
            }
        }
        if (cmd_sock < 0) {
            printf("[CMD] Connecting...\n");
            cmd_sock = connect_to(CMD_PORT);
            if (cmd_sock >= 0) {
                printf("[CMD] Connected ✅\n");
                // 发送设备 ID + 助记名称
                char id_msg[128];
                int id_len = snprintf(id_msg, sizeof(id_msg), "%s|%s\n", g_device_id, g_device_alias);
                write(cmd_sock, id_msg, id_len);
                printf("[CMD] Registered: [%s] (%s) ✅\n", g_device_id, g_device_alias);
            }
        }

        // 如果还是连不上，等 3 秒重试
        if (mqtt_sock < 0 || cmd_sock < 0) {
            sleep(RECONNECT_DELAY);
            continue;
        }

        // ==== 正常运行阶段 ====
        int report_count = 0, last_report = 0;
        int run_ok = 1;

        while (run_ok) {
            fd_set fds; FD_ZERO(&fds);
            int maxfd = mqtt_sock > cmd_sock ? mqtt_sock : cmd_sock;
            FD_SET(mqtt_sock, &fds);
            FD_SET(cmd_sock, &fds);

            struct timeval tv; tv.tv_sec = 1; tv.tv_usec = 0;
            int ret = select(maxfd + 1, &fds, NULL, NULL, &tv);
            if (ret < 0) {
                perror("select");
                // select 出错（如 EINTR），等 1 秒重试
                sleep(1);
                continue;
            }

            // ---- CMD 指令接收 ----
            if (FD_ISSET(cmd_sock, &fds)) {
                char buf[256];
                int n = read(cmd_sock, buf, sizeof(buf) - 1);
                if (n > 0) {
                    buf[n] = 0;
                    char* line = buf;
                    while (*line) {
                        while (*line == '\n' || *line == '\r') line++;
                        if (*line == 0) break;
                        char* end = strchr(line, '\n');
                        if (end) *end = 0;
                        execute_cmd(line, cmd_sock);
                        line = end ? end + 1 : line + strlen(line);
                    }
                } else {
                    printf("[CMD] ❌ Lost connection, will reconnect...\n");
                    close(cmd_sock); cmd_sock = -1;
                    run_ok = 0;
                }
            }

            // ---- MQTT drain ----
            if (FD_ISSET(mqtt_sock, &fds)) {
                drain_mqtt(mqtt_sock);
            }

            // ---- 定时汇报 ----
            time_t now = time(NULL);
            if (now - last_report >= 3) {
                FILE* f = fopen("/proc/loadavg", "r");
                if (f) {
                    char load[64]; fgets(load, 64, f); fclose(f);
                    char* p = load; while (*p) { if (*p == '\n') *p = 0; p++; }
                    printf("[%d] 📤 %s\n", ++report_count, load);
                    mqtt_publish(mqtt_sock, load);
                }
                last_report = now;
            }

            // ---- MQTT 健康检查 ----
            if (mqtt_sock >= 0) {
                int err = 0; socklen_t elen = sizeof(err);
                if (getsockopt(mqtt_sock, SOL_SOCKET, SO_ERROR, &err, &elen) == 0 && err != 0) {
                    printf("[MQTT] ❌ Error detected (%s), reconnecting...\n", strerror(err));
                    close(mqtt_sock); mqtt_sock = -1;
                    run_ok = 0;
                }
            }
        }

        // 正常或异常退出，准备全链路重连
        if (mqtt_sock >= 0) { close(mqtt_sock); mqtt_sock = -1; }
        if (cmd_sock >= 0) { close(cmd_sock); cmd_sock = -1; }
        printf("--- Reconnecting in %ds ---\n", RECONNECT_DELAY);
        sleep(RECONNECT_DELAY);
    }
}
