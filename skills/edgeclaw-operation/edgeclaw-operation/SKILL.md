# EdgeClaw 设备操控 Skill

## ⚠️ 会话加载规则（重要！）
**每次会话中首次涉及 EdgeClaw 设备操控时，必须先读取 `skills/edgeclaw/ARCHITECTURE.md` 全文。**
同一会话中仅需读取一次，后续可直接引用已加载的内容。

## 项目定位
通过智能体 API 直接向 EdgeClaw 边缘节点（LigoWave 路由器）下发指令并获取执行结果，无需人工操作控制台。

**底层逻辑：** 打通智能体 → 服务器 API → CMD 端口 → 路由器的控制链路，让 AI 智能体具备远程操控硬件设备的能力。

---

## 快速开始

### 查看在线设备
```bash
curl -s http://localhost:3001/api/devices
```

返回示例：
```json
[
  {"id":"ec-17A42C","alias":"家用路由","remoteAddress":"::ffff:124.135.42.174","connected":true},
  {"id":"ec-17A1FE","alias":"测试机110","remoteAddress":"::ffff:124.135.42.174","connected":true}
]
```

### 给设备发指令
```bash
curl -s -X POST http://localhost:3001/api/agent/command \
  -H "Content-Type: application/json" \
  -d '{"cmd":"sys_info","deviceId":"ec-17A42C"}'
```

不指定 deviceId 则发给第一个在线设备。

---

## 可用指令（与路由器一一对应）

| 指令 | 功能 | 返回内容示例 |
|------|------|-------------|
| `ping` | 心跳测试 | pong |
| `net_status` | 网络接口状态 | ifconfig 输出 |
| `refresh_load` | 系统负载 | 0.22 0.14 0.10 |
| `scan_wifi` | 扫描 WiFi | iwinfo 输出 |
| `reboot` | 远程重启路由器 | [Rebooting...] |
| `sys_info` | 系统身份、版本、内存 | CPU/内存/运行时间 |
| `signal_quality` | 无线信号质量 | ESSID + Link Quality + Signal level |

---

## API 说明

### POST /api/agent/command

**请求体：**
```json
{
  "cmd": "sys_info",
  "deviceId": "ec-17A42C"    // 可选，不传则发给第一个在线设备
}
```

**返回体：**
```json
{
  "status": "success",
  "deviceId": "ec-17A42C",
  "command": "sys_info",
  "result": "=== [CMD] sys_info ===\nsystem type..."
}
```

**超时：** 5 秒。如果路由器未在 5 秒内返回结果，返回 `"result": "Timeout waiting for result"`。

**错误处理：**
- `400` + `"No device connected"` — 没有设备在线
- `400` + `"Device CMD not connected"` — 指定设备的 CMD 通道未连接

---

## 常用场景

### 查看某台设备的系统信息
```bash
curl -s -X POST http://localhost:3001/api/agent/command \
  -H "Content-Type: application/json" \
  -d '{"cmd":"sys_info","deviceId":"ec-17A42C"}'
```

### 查看某台设备的网络状态
```bash
curl -s -X POST http://localhost:3001/api/agent/command \
  -H "Content-Type: application/json" \
  -d '{"cmd":"net_status","deviceId":"ec-17A1FE"}'
```

### 查看某台设备的信号质量
```bash
curl -s -X POST http://localhost:3001/api/agent/command \
  -H "Content-Type: application/json" \
  -d '{"cmd":"signal_quality","deviceId":"ec-17A42C"}'
```

### 重启设备
```bash
curl -s -X POST http://localhost:3001/api/agent/command \
  -H "Content-Type: application/json" \
  -d '{"cmd":"reboot","deviceId":"ec-17A42C"}'
```

---

## 关联项目
- EdgeClaw 平台：`skills/edgeclaw/`（系统搭建、编译、部署）
- EdgeClaw 架构：`skills/edgeclaw/ARCHITECTURE.md`
