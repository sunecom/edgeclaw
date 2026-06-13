# EdgeClaw — 边缘节点智能体操控平台

基于 OpenClaw 的边缘计算节点系统，将 AI 智能体下沉到物理硬件（LigoWave 路由器），支持远程 Web 控制台管理多台边缘设备，智能体可直接通过 API 操控设备。

## 架构

```
智能体 → POST /api/agent/command {cmd, deviceId}
                     ↓
  服务器 (Node.js)  3001 HTTP/WS + 18883 MQTT + 19999 CMD
                     ↓
  路由器 LigoWave NFT-2ac (MIPS 74Kc, 61MB RAM)
```

## 快速开始

### 编译路由器客户端
```bash
cd skills/edgeclaw
docker run --rm -v $(pwd):/app -w /app ubuntu:22.04 bash -c \
  "apt-get update -qq > /dev/null && apt-get install -y -qq gcc-mips-linux-gnu > /dev/null && \
   mips-linux-gnu-gcc -static -o /app/public/monitor_edgeclaw /app/monitor_edgeclaw.c"
```

### 启动服务器
```bash
cd skills/edgeclaw && node server.js
```

### 查看在线设备
```bash
curl http://localhost:3001/api/devices
```

### 智能体操控设备
```bash
curl -X POST http://localhost:3001/api/agent/command \
  -H "Content-Type: application/json" \
  -d '{"cmd":"net_status","deviceId":"ec-17A42C"}'
```

## 当前在线设备
- 家用路由（ec-17A42C）
- 测试机110（ec-17A1FE）

## 版本
v4.2 — 多节点 + 智能体操控版

更多信息见 `skills/edgeclaw/ARCHITECTURE.md`
