# EdgeClaw 架构文档 (v4.2 — 多节点 + 智能体操控版)

## ⚠️ 项目生命线

```bash
# 编译（改 C 代码后必做）
docker run --rm -v /home/admin/.openclaw/workspace/skills/edgeclaw:/app -w /app ubuntu:22.04 bash -c \
  "apt-get update -qq > /dev/null && apt-get install -y -qq gcc-mips-linux-gnu > /dev/null && \
   mips-linux-gnu-gcc -static -o /app/public/monitor_edgeclaw /app/monitor_edgeclaw.c"

# 部署（路由器上执行 /etc/rc.local 或 edgeclaw-autorun.sh）
wget -q http://47.253.201.85:3001/monitor_edgeclaw -O /tmp/monitor_edgeclaw && chmod +x /tmp/monitor_edgeclaw && killall monitor_edgeclaw && /tmp/monitor_edgeclaw > /tmp/edgeclaw.log 2>&1 &

# 重启服务器
kill $(pgrep -f "node server.js") && cd /home/admin/.openclaw/workspace/skills/edgeclaw && nohup node server.js > /tmp/edgeclaw.log 2>&1 &
```

## 架构图

```
┌────────── 智能体（盖茨）──────────┐
│ curl /api/agent/command          │
└──────────────┬───────────────────┘
               │ POST {"cmd":"net_status","deviceId":"ec-17A1FE"}
               ▼
服务器 47.253.201.85 (Node.js)
  3001 → Web UI + HTTP API + WS 广播 + 智能体 API
  18883 → MQTT Broker (aedes 标准库) — 路由器状态汇报
  19999 → CMD 实时指令（双向），select 多路复用

设备注册：devices.json 持久化（重启不丢设备列表和别名）

路由器 (LigoWave NFT-2ac, MIPS 74Kc, 61MB RAM)
  /tmp/monitor_edgeclaw (C 语言 ~693KB，静态链接)
  ├── MQTT → 18883 (每 3 秒汇报负载)
  ├── CMD ←→ 19999 (实时接收指令 + 回传执行结果)
  └── Device ID 从 hostname 自动生成，代码完全通用
```

## 多节点机制

```
设备注册：MQTT CONNECT Client ID = 设备唯一标识
          CMD 第一条消息 = "设备ID|hostname"

服务器：devices = Map<deviceId, {mqttSocket, cmdSocket, alias, remoteAddress}>
持久化：devices.json 保存设备 ID + 别名
别名：控制台手动设置，或 C 端从 hostname 自动读取

使用举例：
  你："看看测试机110的网络状态"
  我：curl .../api/agent/command {cmd:"net_status", deviceId:"ec-17A1FE"}
  结果：直接返回路由器 ifconfig 输出
```

## 当前在线设备

| 别名 | 设备 ID | IP |
|------|---------|-----|
| 家用路由 | ec-17A42C | 124.135.42.174 |
| 测试机110 | ec-17A1FE | 124.135.42.174 |

## 指令清单

| 指令 | 底层 Shell | 踩坑记录 |
|------|-----------|---------|
| ping | 直接 pong | — |
| net_status | ifconfig | — |
| refresh_load | cat /proc/loadavg | — |
| scan_wifi | iwinfo | — |
| reboot | reboot | — |
| sys_info | cat /proc/cpuinfo + uptime + free -m | ❌ `ubus` 不存在 |
| signal_quality | iwconfig ath0 + ath1 (取 ESSID/Signal) | ❌ 无 `iwinfo`，接口名是 `ath0/ath1` 非 `wlan0` |

## API 接口

| 端点 | 方法 | 用途 |
|------|------|------|
| `/api/devices` | GET | 获取在线设备列表 |
| `/api/command` | POST | 控制台发指令（前端用） |
| `/api/agent/command` | POST | 智能体发指令（`{cmd, deviceId}` → 直接返回结果） |
| `/api/setalias` | POST | 设置设备别名（`{deviceId, alias}`） |

**智能体调用示例：**
```bash
curl -s -X POST http://localhost:3001/api/agent/command \
  -H "Content-Type: application/json" \
  -d '{"cmd":"net_status","deviceId":"ec-17A1FE"}'
```

## 硬件约束

| 项 | 值 | 影响 |
|----|----|------|
| CPU | MIPS 74Kc 大端序 | 交叉编译必须 `mips-linux-gnu-gcc` |
| RAM | 61MB | Go 8.6MB OOM → C 692KB ✅ |
| /tmp | 61MB (重启丢失) | 唯一可用目录 |
| 根分区 | 9.8MB 只读 | 不能装软件 |
| 系统 | Linux 4.4.14 + BusyBox | 很多命令缺失（`ubus` / `file` / `iwinfo`） |

## 编译环境要点

- 本机（Alibaba Cloud Linux）yum 没有 `gcc-mips-linux-gnu`
- **只能通过 Docker**（ubuntu:22.04 + apt 安装）编译
- 必须加 `-static` 静态链接
- 产物 ~693KB，路由器从 `http://47.253.201.85:3001/monitor_edgeclaw` 下载

## 踩坑简史

| # | 问题 | 解决 |
|---|------|------|
| 1 | Go 8.6MB OOM | 改 C 语言 692KB |
| 2 | 1883 端口被禁 | 改 18883 |
| 3 | MQTT+指令同管道打架 | 双管道(18883+19999) |
| 4 | system() 静默失败 | 改 popen |
| 5 | select 时延 | 实时监听 |
| 6 | MQTT 手写协议不专业 | 换 aedes 标准 Broker |
| 7 | 重启丢设备列表 | 加 devices.json 持久化 |
| 8 | ubus 不可用 | cat /proc/cpuinfo |
| 9 | iwinfo 不可用 / 接口名 wlan0 不对 | iwconfig ath0 + ath1 |
| 10 | 智能体不能操控设备 | 加 /api/agent/command 接口 |

## Skill 清单

| Skill | 路径 | 用途 |
|-------|------|------|
| edgeclaw | `skills/edgeclaw/` | 搭平台：编译、部署、重启服务器 |
| edgeclaw-operation | `skills/edgeclaw-operation/` | 操控设备：智能体发指令拿结果 |
