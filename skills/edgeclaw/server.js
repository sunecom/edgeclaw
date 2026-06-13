const http = require('http');
const fs = require('fs');
const path = require('path');
const net = require('net');
const WebSocket = require('ws');
const aedes = require('aedes')();

// ====== 全局异常兜底 ======
process.on('uncaughtException', (err) => {
    console.error('[FATAL] Uncaught Exception:', err.message);
});
process.on('unhandledRejection', (reason) => {
    console.error('[FATAL] Unhandled Rejection:', reason);
});

const HTTP_PORT = 3001;
const MQTT_PORT = 18883;
const CMD_PORT = 19999;
let lastLogs = [];
const MAX_LOGS = 200;
let clients = new Set(); // WebSocket clients

// ====== 多节点设备表 ======
// Map<deviceId, { mqttSocket, cmdSocket, remoteAddress, lastHeartbeat }>
const devices = new Map();
const DATA_FILE = path.join(__dirname, 'devices.json');

// 设备数据持久化
function saveDevices() {
    const data = {};
    for (const [id, info] of devices) {
        data[id] = { alias: info.alias || '', remoteAddress: info.remoteAddress };
    }
    try { fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2)); }
    catch (e) { /* 写失败不崩溃 */ }
}

function loadDevices() {
    try {
        if (fs.existsSync(DATA_FILE)) {
            const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
            for (const [id, info] of Object.entries(data)) {
                devices.set(id, {
                    mqttSocket: null,
                    cmdSocket: null,
                    remoteAddress: info.remoteAddress || '',
                    lastHeartbeat: null,
                    alias: info.alias || ''
                });
            }
            console.log(`[DATA] Loaded ${Object.keys(data).length} devices from ${DATA_FILE}`);
        }
    } catch (e) {
        console.log('[DATA] No saved devices found, starting fresh');
    }
}

// 启动时加载
loadDevices();

function getDeviceList() {
    const list = [];
    for (const [id, info] of devices) {
        list.push({
            id,
            alias: info.alias || '',
            remoteAddress: info.remoteAddress,
            lastHeartbeat: info.lastHeartbeat,
            connected: true
        });
    }
    return list;
}

// 带容量保护的消息推送
function addLog(msg) {
    const entry = `[${new Date().toLocaleTimeString()}] ${msg}`;
    lastLogs.push(entry);
    if (lastLogs.length > MAX_LOGS) lastLogs.shift();
}

// ====== 解析 MQTT CONNECT 包中的 Client ID ======
// ====== MQTT Broker (使用 aedes 标准库) ======
// 替换了之前的纯手写 MQTT 协议解析
const mqttServer = require('net').createServer(aedes.handle);
const MQTT_STATUS_TOPIC = 'edgeclaw/ligowave/status';

aedes.on('client', (client) => {
    const deviceId = client.id;
    console.log(`[MQTT] 🔌 Client connected: ${deviceId}`);
    addLog(`🔌 MQTT: ${deviceId} connected`);
    
    let dev = devices.get(deviceId);
    if (!dev) {
        dev = { mqttSocket: 'aedes', cmdSocket: null, remoteAddress: '', lastHeartbeat: Date.now() };
        devices.set(deviceId, dev);
        saveDevices();
    }
    dev.mqttSocket = 'aedes';
    dev.lastHeartbeat = Date.now();
    addLog(`🟢 Node [${deviceId}] connected via MQTT Broker`);
    broadcastNodes();
});

aedes.on('clientDisconnect', (client) => {
    const deviceId = client.id;
    console.log(`[MQTT] ❌ Client disconnected: ${deviceId}`);
    const dev = devices.get(deviceId);
    if (dev) {
        dev.mqttSocket = null;
        if (!dev.cmdSocket) {
            devices.delete(deviceId);
            addLog(`🔴 Node [${deviceId}] fully disconnected`);
            saveDevices();
        } else {
            addLog(`🔴 Node [${deviceId}] MQTT disconnected (CMD still up)`);
        }
        broadcastNodes();
    }
});

aedes.on('publish', (packet, client) => {
    if (!client) return;
    const deviceId = client.id;
    if (packet.topic === MQTT_STATUS_TOPIC) {
        const raw = packet.payload.toString().trim();
        const dev = devices.get(deviceId);
        if (dev) dev.lastHeartbeat = Date.now();
        addLog(`📡 [${deviceId}] Load: ${raw}`);
        const msg = JSON.stringify({ type: 'status', data: raw, deviceId, timestamp: Date.now() });
        clients.forEach(ws => {
            if (ws.readyState === WebSocket.OPEN) ws.send(msg);
        });
    }
});

mqttServer.listen(MQTT_PORT, () => {
    console.log(`[MQTT] 🟢 MQTT Broker (aedes) on port ${MQTT_PORT}`);
});

// ====== CMD 端口：实时指令下发 + 异步设备识别 ======
const cmdServer = net.createServer((socket) => {
    let deviceId = null;
    let buf = '';

    console.log('[CMD] 🔌 CMD client connected from', socket.remoteAddress);
    
    socket.on('data', (data) => {
        buf += data.toString();
        
        // 按行处理
        let nl;
        while ((nl = buf.indexOf('\n')) !== -1) {
            const line = buf.substring(0, nl).trim();
            buf = buf.substring(nl + 1);
            if (!line) continue;
            
            if (!deviceId) {
                // 第一条消息：设备ID|助记名称
                const parts = line.split('|');
                deviceId = parts[0];
                const alias = parts[1] || '';
                console.log(`[CMD] ✅ Device identified: ${deviceId} (${alias})`);
                
                let dev = devices.get(deviceId);
                if (!dev) {
                    dev = { mqttSocket: null, cmdSocket: null, remoteAddress: socket.remoteAddress, lastHeartbeat: null, alias };
                    devices.set(deviceId, dev);
                } else {
                    dev.alias = alias;
                }
                if (dev.cmdSocket && dev.cmdSocket !== socket && !dev.cmdSocket.destroyed) {
                    dev.cmdSocket.destroy();
                }
                dev.cmdSocket = socket;
                dev.remoteAddress = socket.remoteAddress;
                
                saveDevices();
                addLog(`🟢 Node [${deviceId}] (${alias}) CMD ready`);
                broadcastNodes();
                continue;
            }
            
            // 执行结果回传
            console.log(`[CMD] 📩 [${deviceId}] Result:`, line.substring(0, 80));
            addLog(`📩 [${deviceId}]: ${line}`);
            
            // 广播到前端
            const msg = JSON.stringify({ type: 'cmd_result', data: line, deviceId });
            clients.forEach(ws => {
                if (ws.readyState === WebSocket.OPEN) ws.send(msg);
            });
        }
    });

    socket.on('close', () => {
        console.log('[CMD] ❌ CMD client disconnected:', deviceId || socket.remoteAddress);
        if (deviceId) {
            const dev = devices.get(deviceId);
            if (dev && dev.cmdSocket === socket) {
                dev.cmdSocket = null;
                if (!dev.mqttSocket) {
                    devices.delete(deviceId);
                    addLog(`🔴 Node [${deviceId}] fully disconnected`);
                } else {
                    addLog(`🔴 Node [${deviceId}] CMD disconnected (MQTT still up)`);
                }
                broadcastNodes();
            }
        }
    });
    
    socket.on('error', (err) => {
        console.log('[CMD] ⚠️ CMD socket error:', deviceId || socket.remoteAddress, err.message);
    });
});
cmdServer.listen(CMD_PORT, () => {
    console.log(`[CMD] 🟢 CMD listener on port ${CMD_PORT}`);
});

// ====== HTTP + WebSocket ======
const server = http.createServer((req, res) => {
    if (req.url === '/ws') return;

    // 静态文件服务：二进制/脚本下载
    const staticFiles = ['monitor_mips', 'monitor_c', 'monitor_final', 'monitor_edgeclaw', 'edgeclaw-autorun.sh', 'cmd_poll.sh', 'poll.sh'];
    for (const file of staticFiles) {
        if (req.url.startsWith('/' + file)) {
            const filePath = path.join(__dirname, 'public', file);
            if (fs.existsSync(filePath)) {
                const fileStream = fs.createReadStream(filePath);
                res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
                fileStream.pipe(res);
                return;
            }
        }
    }

    if (req.url === '/') {
        const html = fs.readFileSync(path.join(__dirname, 'public', 'index.html'));
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(html);
    } else if (req.url === '/api/status') {
        const list = getDeviceList();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
            connected: list.length > 0, 
            devices: list,
            total: list.length
        }));
    } else if (req.url === '/api/devices') {
        // 返回节点列表（前端设备选择器用）
        const list = getDeviceList();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(list));
    } else if (req.url === '/api/logs') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        const logsToSend = [...lastLogs];
        lastLogs = [];
        res.end(JSON.stringify({ logs: logsToSend }));
    } else if (req.url.startsWith('/api/command') && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
            try {
                const { cmd, deviceId: targetId } = JSON.parse(body);
                
                // 如果没指定设备，用第一个
                let targetDeviceId = targetId;
                if (!targetDeviceId) {
                    const first = devices.values().next().value;
                    if (!first) {
                        res.writeHead(400);
                        res.end(JSON.stringify({ status: 'error', message: 'No device connected' }));
                        return;
                    }
                    // 找第一个有 cmdSocket 的设备
                    for (const [id, dev] of devices) {
                        if (dev.cmdSocket && !dev.cmdSocket.destroyed) {
                            targetDeviceId = id;
                            break;
                        }
                    }
                }
                
                if (!targetDeviceId) {
                    res.writeHead(400);
                    res.end(JSON.stringify({ status: 'error', message: 'No device connected' }));
                    return;
                }
                
                const dev = devices.get(targetDeviceId);
                if (!dev || !dev.cmdSocket || dev.cmdSocket.destroyed) {
                    res.writeHead(400);
                    res.end(JSON.stringify({ status: 'error', message: `Device [${targetDeviceId}] CMD not connected` }));
                    return;
                }
                
                console.log(`[CMD] 🎯 [${targetDeviceId}] Web button: ${cmd}`);
                addLog(`🎮 [Web Cmd] ${cmd} → [${targetDeviceId}]`);
                
                const msg = `${cmd}\n`;
                dev.cmdSocket.write(msg);
                console.log(`[CMD] 📤 Pushed to [${targetDeviceId}]: ${cmd}`);
                
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ status: 'success', command: cmd, deviceId: targetDeviceId }));
            } catch (e) {
                res.writeHead(400);
                res.end(JSON.stringify({ status: 'error', message: e.message }));
            }
        });
    } else if (req.url.startsWith('/api/setalias') && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
            try {
                const { deviceId, alias } = JSON.parse(body);
                const dev = devices.get(deviceId);
                if (!dev) {
                    res.writeHead(400);
                    res.end(JSON.stringify({ status: 'error', message: 'Device not found' }));
                    return;
                }
                dev.alias = alias;
                saveDevices();
                addLog(`🏷️ Alias [${deviceId}] set to "${alias}"`);
                broadcastNodes();
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ status: 'success', alias }));
            } catch (e) {
                res.writeHead(400);
                res.end(JSON.stringify({ status: 'error', message: e.message }));
            }
        });
    } else if (req.url.startsWith('/api/agent/command') && req.method === 'POST') {
        // 智能体 API：让盖茨能直接给设备发指令并取回结果
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
            try {
                const { cmd, deviceId } = JSON.parse(body);
                
                // 没指定设备则找第一个
                let targetId = deviceId;
                if (!targetId) {
                    for (const [id, dev] of devices) {
                        if (dev.cmdSocket && !dev.cmdSocket.destroyed) {
                            targetId = id;
                            break;
                        }
                    }
                }
                
                if (!targetId) {
                    res.writeHead(400);
                    res.end(JSON.stringify({ status: 'error', message: 'No device connected' }));
                    return;
                }
                
                const dev = devices.get(targetId);
                if (!dev || !dev.cmdSocket || dev.cmdSocket.destroyed) {
                    res.writeHead(400);
                    res.end(JSON.stringify({ status: 'error', message: 'Device CMD not connected' }));
                    return;
                }
                
                addLog(`🤖 [Agent Cmd] ${cmd} → [${targetId}]`);
                
                // 发送指令
                dev.cmdSocket.write(cmd + '\n');
                
                // 等待结果（最长 5 秒）
                const resultPromise = new Promise((resolve) => {
                    let resultBuf = '';
                    const timeout = setTimeout(() => {
                        resolve(resultBuf || 'Timeout waiting for result');
                    }, 5000);
                    
                    const handler = (data) => {
                        resultBuf += data.toString();
                        // 如果收到了完整的结果（多行），等一下看还有没有更多
                        clearTimeout(timeout);
                        setTimeout(() => {
                            dev.cmdSocket.removeListener('data', handler);
                            resolve(resultBuf);
                        }, 200);
                    };
                    
                    dev.cmdSocket.on('data', handler);
                    dev.cmdSocket.once('close', () => {
                        clearTimeout(timeout);
                        resolve(resultBuf || 'Connection closed');
                    });
                });
                
                resultPromise.then(result => {
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ status: 'success', deviceId: targetId, command: cmd, result: result.trim() }));
                });
            } catch (e) {
                res.writeHead(400);
                res.end(JSON.stringify({ status: 'error', message: e.message }));
            }
        });
    } else {
        res.writeHead(404);
        res.end('Not Found');
    }
});

const wsServer = new WebSocket.Server({ server, path: '/ws' });

wsServer.on('connection', (ws) => {
    clients.add(ws);
    console.log('[WS] Client connected. Total:', clients.size);
    
    // 连接后立即发送设备列表
    ws.send(JSON.stringify({ type: 'devices', data: getDeviceList() }));
    
    ws.on('close', () => {
        clients.delete(ws);
        console.log('[WS] Client disconnected. Total:', clients.size);
    });
});

// 广播设备列表到所有前端
function broadcastNodes() {
    const msg = JSON.stringify({ type: 'devices', data: getDeviceList() });
    clients.forEach(ws => {
        if (ws.readyState === WebSocket.OPEN) ws.send(msg);
    });
}

server.listen(HTTP_PORT, '0.0.0.0', () => {
    console.log(`[Web UI] http://localhost:${HTTP_PORT}`);
    console.log(`[Web UI] https://ec.aitomoney.online`);
});