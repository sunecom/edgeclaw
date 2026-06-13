# EdgeClaw 边缘节点项目 Skill

## ⚠️ 会话加载规则（重要！）
**每次会话中首次涉及 EdgeClaw 项目时，必须先读取 `skills/edgeclaw/ARCHITECTURE.md` 全文。**
同一会话中仅需读取一次，后续可直接引用已加载的内容。

## 项目定位
基于 OpenClaw 的边缘计算节点系统，将 AI 智能体下沉到物理硬件（LigoWave 路由器）。

## ⚡ 编译环境 — 项目生命线（重要！）

EdgeClaw 客户端代码是用 **C 语言** 编写的，而 LigoWave 路由器（MIPS 74Kc）仅有 61MB RAM 且根分区只读，**没有 gcc 编译器**。因此必须通过 **交叉编译** 生成 MIPS 大端序的静态二进制文件。

**没有交叉编译环境，代码就是一堆无法运行的文本。**

### 编译环境位置
- **本机（47.253.201.85，阿里云）** — 就是盖茨运行的这个服务器
- 通过 **Docker + Ubuntu 22.04 + gcc-mips-linux-gnu** 实现交叉编译
- 每次编译运行标准 Docker 命令即可，无需持久化工具链

### 编译命令（一劳永逸）
```bash
# 在 skills/edgeclaw 目录下执行
docker run --rm -v $(pwd):/app -w /app ubuntu:22.04 bash -c \
  "apt-get update > /dev/null && apt-get install -y gcc-mips-linux-gnu > /dev/null && \
   mips-linux-gnu-gcc -static -o public/monitor_edgeclaw monitor_edgeclaw.c"
```

### 编译产物特征
- **文件**：`public/monitor_edgeclaw`
- **大小**：约 708KB（Go 版本 8.6MB 在 MIPS 上会 OOM 闪退！）
- **架构**：`ELF 32-bit MSB, MIPS, MIPS32 rel2, statically linked`
- 正确的大端序（MSB）是 LigoWave NFT-2ac 的硬件要求

### 部署方式
路由器开机自启脚本 `edgeclaw-autorun.sh` 会自动从 `http://47.253.201.85:3001/monitor_edgeclaw` 下载最新版，无需手动操作。

### 发生过的问题
- ❌ Go 语言编译的二进制（8MB+）→ MIPS 上内存耗尽 OOM 闪退
- ✅ 改 C 语言交叉编译后 → 708KB，稳定运行

## 最终架构 (v4 - 双管道实时控制)
- **Web 控制台**：`https://ec.aitomoney.online`（赛博朋克 UI，真实状态灯驱动）
- **物理节点**：LigoWave NFT-2ac（MIPS 74Kc，大端序，Linux 4.4.14）
- **双管道通信**：
  - **连接A (TCP 18883)**：MQTT 汇报，路由器→服务器，每 3 秒发负载数据，维持网页绿灯
  - **连接B (TCP 19999)**：CMD 指令接收，服务器→路由器，`select` 多路复用实时读取，毫秒级响应

## 使用方式
### 路由器上更新客户端
自动更新（推荐，带步骤提示）：
```bash
/etc/rc.local
```

手动操作（调试用）：
```bash
wget -q http://47.253.201.85:3001/monitor_edgeclaw -O /tmp/monitor_edgeclaw
chmod +x /tmp/monitor_edgeclaw
killall -9 monitor_edgeclaw
/tmp/monitor_edgeclaw > /tmp/edgeclaw.log 2>&1 &
```

### 网页操作
打开 `https://ec.aitomoney.online`，点击按钮即可实时下发指令。

## 关键文件
- `server.js`：Node.js 后端（监听 3001/18883/19999）
- `public/index.html`：前端控制台 UI
- `monitor_edgeclaw.c`：路由器 C 语言客户端（select 多路复用）

## 可用指令
| 指令 | 操作 |
|------|------|
| `net_status` | 执行 ifconfig |
| `refresh_load` | 刷新负载（打印 /proc/loadavg） |
| `ping` | 测试响应（打印 pong） |
| `reboot` | 重启路由器 |
| `scan_wifi` | 扫描 WiFi（执行 iwinfo） |
| `sys_info` | 系统身份：CPU型号/固件版本/运行时间/内存（cat /proc/cpuinfo + uptime + free -m） |
| `signal_quality` | 无线信号质量：ath0(2.4G) + ath1(5G) ESSID/信号强度/Link Quality（iwconfig） |

## 端口清单
| 端口 | 用途 |
|------|------|
| 3001 | Web UI / HTTP API |
| 18883 | MQTT 状态汇报 |
| 19999 | CMD 实时指令下发 |

## 常用命令
- **启动服务**：`cd skills/edgeclaw && node server.js`
- **后台启动**：`cd skills/edgeclaw && nohup node server.js > /tmp/edgeclaw.log 2>&1 &`
- **查看日志**：`tail -f /tmp/edgeclaw.log`
- **检查端口**：`netstat -tuln | grep -E "3001|18883|19999"`

## 编译路由器客户端
```bash
cd skills/edgeclaw
docker run --rm -v $(pwd):/app -w /app ubuntu:22.04 bash -c \
  "apt-get update > /dev/null && apt-get install -y gcc-mips-linux-gnu > /dev/null && \
   mips-linux-gnu-gcc -static -o public/monitor_edgeclaw monitor_edgeclaw.c"
```

**注意：gcc-mips-linux-gnu 未安装在本机系统上**（阿里云 yum 源没有此包），必须通过 Docker 编译。

## 关键技术决策
- **双管道而非单管道**：避免 MQTT 协议包与纯文本指令在同一条 TCP 连接中打架
- **select 多路复用**：同时监听两条连接，比单线程轮询更高效，响应即时
- **纯 C 语言 HTTP 拉取被弃用原因**：`system()` 和 `popen()` 在 MIPS busybox 环境下静默失败，不如原生 Socket 可靠
- **C 语言客户端 vs Shell 脚本**：C 语言资源开销更低，select 模型更高效，编译后单文件无依赖

## 关联文档
- [EdgeClaw 项目方案](../../docs/EdgeClaw边缘节点项目/01-项目方案/)
- [EdgeClaw 技术文档](../../docs/EdgeClaw边缘节点项目/02-技术文档/)
- [2026-06-12 最终实战复盘](../../docs/EdgeClaw边缘节点项目/06-项目记忆/2026-06-12-MQTT实战复盘.md)