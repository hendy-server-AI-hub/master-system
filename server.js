const express = require('express');
const http = require('http');
const path = require('path');
const WebSocket = require('ws');
const { Server } = require('socket.io');
const { WebcastPushConnection } = require('tiktok-live-connector');
require('dotenv').config();

const app = express();
const server = http.createServer(app);

const PORT = process.env.PORT || 3000;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';

// --- WebSocket Dual-Engine Setup ---
// Native WebSocket Server cho Slave/Bot Hub (đường dẫn /ws)
const wss = new WebSocket.Server({ noServer: true });

// Socket.IO Server cho Control Panel Interface (đường dẫn /socket.io)
const io = new Server(server, { cors: { origin: '*' }, pingInterval: 5000, pingTimeout: 2000 });

// Phân luồng HTTP Upgrade request giữa WS và Socket.IO
server.on('upgrade', (request, socket, head) => {
    const pathname = new URL(request.url, `http://${request.headers.host}`).pathname;
    if (pathname === '/socket.io/') {
        // Socket.IO tự xử lý upgrade
        return;
    }
    wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
    });
});

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.static(__dirname));

// ==========================================
// 💾 IN-MEMORY DATABASE & STATE STORAGE
// ==========================================
let users = [
    { id: 1, username: 'admin_hades', name: 'Hades Admin', role: 'SuperAdmin', status: 'Active' },
    { id: 2, username: 'hendy_op', name: 'Hendy Operator', role: 'Operator', status: 'Active' },
    { id: 3, username: 'viewer_01', name: 'Guest Viewer', role: 'Viewer', status: 'Inactive' }
];

const activeSlaves = new Map();
const activeBots = new Map();
const activeLiveMonitors = new Map();

// Global Broadcast helper (cho cả Native WS lẫn Socket.IO)
function broadcastToAll(data) {
    const payload = typeof data === 'string' ? data : JSON.stringify(data);
    
    // Broadcast tới tất cả client Native WebSocket
    wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(payload);
        }
    });

    // Broadcast tới tất cả client Socket.IO (Dashboard UI)
    io.emit('system_broadcast', typeof data === 'string' ? JSON.parse(data) : data);
}

// ==========================================
// 🛡️ MIDDLEWARE: RBAC AUTHORIZATION
// ==========================================
const authorize = (allowedRoles) => {
    return (req, res, next) => {
        const userRole = req.headers['x-user-role'] || 'Viewer';
        if (!allowedRoles.includes(userRole)) {
            return res.status(403).json({ success: false, message: 'Quyền truy cập bị từ chối (403 Forbidden)' });
        }
        next();
    };
};

// ==========================================
// 👤 REST API: QUẢN LÝ NGƯỜI DÙNG (CRUD)
// ==========================================
app.get('/api/v1/users', authorize(['SuperAdmin', 'Operator', 'Viewer']), (req, res) => {
    res.json({ success: true, data: users });
});

app.post('/api/v1/users', authorize(['SuperAdmin']), (req, res) => {
    const { username, name, role } = req.body;
    if (!username || !role) return res.status(400).json({ success: false, message: 'Thiếu thông tin người dùng' });
    const newUser = { id: Date.now(), username, name: name || username, role, status: 'Active' };
    users.push(newUser);
    io.emit('user_updated', { action: 'CREATE', user: newUser });
    res.status(201).json({ success: true, data: newUser });
});

app.put('/api/v1/users/:id', authorize(['SuperAdmin']), (req, res) => {
    const { id } = req.params;
    const { name, role, status } = req.body;
    const index = users.findIndex(u => u.id == id);
    if (index === -1) return res.status(404).json({ success: false, message: 'Không tìm thấy người dùng' });

    users[index] = { 
        ...users[index], 
        name: name || users[index].name, 
        role: role || users[index].role, 
        status: status || users[index].status 
    };
    io.emit('user_updated', { action: 'UPDATE', user: users[index] });
    res.json({ success: true, data: users[index] });
});

app.delete('/api/v1/users/:id', authorize(['SuperAdmin']), (req, res) => {
    const { id } = req.params;
    users = users.filter(u => u.id != id);
    io.emit('user_updated', { action: 'DELETE', id: Number(id) });
    res.json({ success: true, message: 'Xóa người dùng thành công' });
});

// ==========================================
// 📊 REST API: HỆ THỐNG & MONITORING
// ==========================================
app.get('/api/v1/system/status', (req, res) => {
    res.json({
        success: true,
        data: {
            system: 'Master Control Panel - Hendy & Hades V6100 Pro',
            uptime: Math.floor(process.uptime()),
            activeBots: activeBots.size,
            activeSlaves: activeSlaves.size,
            activeLiveSessions: activeLiveMonitors.size,
            totalUsers: users.length
        }
    });
});

app.get('/api/slaves', (req, res) => {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    const slavesList = [];
    activeSlaves.forEach((client) => {
        slavesList.push({
            id: client.id,
            name: client.name,
            role: client.role,
            isOnLive: client.isOnLive,
            url: client.url,
            lastSeen: new Date(client.lastSeen).toLocaleTimeString('vi-VN')
        });
    });
    res.send(JSON.stringify(slavesList, null, 2));
});

app.get('/api/bots', (req, res) => {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.send(JSON.stringify(Array.from(activeBots.values()), null, 2));
});

app.get('/send-command', (req, res) => {
    const cmd = req.query.cmd || 'ĐIỂM DANH + SC88 +';
    let count = 0;
    wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({ action: `CHAT|${cmd}` }));
            count++;
        }
    });
    res.send(`🚀 Đã phát lệnh thành công cho ${count} thiết bị: [ ${cmd} ]`);
});

// ==========================================
// 🤖 AI MANAGER ENGINE
// ==========================================
async function processAiManagerCommand(userPrompt, systemContext) {
    const prompt = userPrompt.toLowerCase().trim();
    
    if (GEMINI_API_KEY) {
        try {
            const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{
                        parts: [{
                            text: `Bạn là AI Quản Lý Hệ Thống Hendy & Hades V6100 Pro. 
Trạng thái hệ thống hiện tại: 
- Số lượng Bot active: ${systemContext.botCount || 0}
- Số lượng Slave connected: ${systemContext.slaveCount || 0}
- Số phiên Live đang mở: ${systemContext.liveCount || 0}

Người dùng gửi câu lệnh: "${userPrompt}"

Hãy phân tích lệnh và trả về DUY NHẤT một chuỗi JSON theo định dạng chuẩn sau:
{
  "action": "START_ALL_BOTS" | "STOP_ALL_BOTS" | "ADD_BOT" | "EXPORT_CSV" | "CLEAR_LOGS" | "LOCK_USER" | "SYSTEM_STATUS" | "START_LIVE_BOOST" | "STOP_LIVE_BOOST" | "UNKNOWN",
  "reply": "Lời phản hồi ngắn gọn, chuyên nghiệp bằng tiếng Việt",
  "params": { "count": 1, "target": "" }
}`
                        }]
                    }]
                })
            });

            const data = await response.json();
            const textResponse = data.candidates?.[0]?.content?.parts?.[0]?.text;
            if (textResponse) {
                const cleanedJson = textResponse.replace(/```json|```/g, '').trim();
                return JSON.parse(cleanedJson);
            }
        } catch (err) {
            console.error('[AI GEMINI ERROR]:', err);
        }
    }

    let action = 'UNKNOWN';
    let reply = '🤖 AI Quản lý chưa hiểu rõ yêu cầu. Bạn có thể thử: "Chạy tất cả bot", "Dừng bot", "Thêm 3 bot", "Tăng mắt live", "Xuất báo cáo", hoặc "Báo cáo trạng thái".';
    let params = {};

    if (prompt.includes('chạy') || prompt.includes('bắt đầu') || prompt.includes('start')) {
        action = 'START_ALL_BOTS';
        reply = '🚀 AI Manager đã phát lệnh kích hoạt TẤT CẢ các Bot trong hệ thống!';
    } else if (prompt.includes('dừng') || prompt.includes('stop') || prompt.includes('tắt')) {
        action = 'STOP_ALL_BOTS';
        reply = '⏹ AI Manager đã tạm dừng hoạt động của tất cả các Bot!';
    } else if (prompt.includes('thêm bot') || prompt.includes('tạo bot') || prompt.includes('add bot')) {
        action = 'ADD_BOT';
        const match = prompt.match(/\d+/);
        const count = match ? parseInt(match[0]) : 1;
        params = { count };
        reply = `➕ AI Manager đã thêm thành công ${count} tài khoản Bot mới vào Hub!`;
    } else if (prompt.includes('xuất') || prompt.includes('báo cáo') || prompt.includes('csv') || prompt.includes('download')) {
        action = 'EXPORT_CSV';
        reply = '📥 AI Manager đã tạo và tải về tệp báo cáo danh sách Bot!';
    } else if (prompt.includes('xóa log') || prompt.includes('dọn log') || prompt.includes('clear')) {
        action = 'CLEAR_LOGS';
        reply = '🗑️ AI Manager đã dọn dẹp sạch sẽ toàn bộ nhật ký hệ thống.';
    } else if (prompt.includes('trạng thái') || prompt.includes('kiểm tra') || prompt.includes('status') || prompt.includes('sức khỏe')) {
        action = 'SYSTEM_STATUS';
        reply = `📊 BÁO CÁO SỨC KHỎE HỆ THỐNG:\n- Số Slave đang kết nối: ${systemContext.slaveCount || 0}\n- Số Bot đang lưu trữ: ${systemContext.botCount || 0}\n- Số Phiên Live đang chạy: ${systemContext.liveCount || 0}\n- WebSocket Hub: ONLINE 🟢`;
    }

    return { action, reply, params };
}

app.post('/api/ai/manage', async (req, res) => {
    try {
        const { prompt, context } = req.body;
        if (!prompt) {
            return res.status(400).json({ error: 'Vui lòng cung cấp câu lệnh' });
        }

        const systemContext = {
            slaveCount: activeSlaves.size,
            botCount: activeBots.size,
            liveCount: activeLiveMonitors.size,
            ...(context || {})
        };

        const result = await processAiManagerCommand(prompt, systemContext);

        broadcastToAll({
            type: 'AI_MANAGER_ACTION',
            action: result.action,
            params: result.params,
            sender: 'AI_SERVER'
        });

        res.json({ success: true, data: result });
    } catch (error) {
        console.error('[AI API ERROR]:', error);
        res.status(500).json({ error: 'Lỗi xử lý AI Manager' });
    }
});

// ==========================================
// 🔴 LIVE STREAM & TIKTOK CONNECTOR ENGINE
// ==========================================
app.post('/api/live/start-boost', (req, res) => {
    try {
        const { platform, targetUrl, username, targetViewers } = req.body;
        
        if (!platform || (!targetUrl && !username)) {
            return res.status(400).json({ success: false, error: 'Thiếu thông tin nền tảng hoặc Username/URL phòng live' });
        }

        const sessionId = 'LIVE_' + Math.random().toString(36).substring(2, 8);
        const targetViewersCount = parseInt(targetViewers) || 500;

        if (platform.toLowerCase() === 'tiktok' && username) {
            const cleanUsername = username.replace('@', '').trim();
            try {
                const tiktokConnection = new WebcastPushConnection(cleanUsername);

                tiktokConnection.connect().then(state => {
                    console.log(`[TIKTOK LIVE CONNECTED] Room ID: ${state.roomId} | User: @${cleanUsername}`);
                    broadcastToAll({
                        type: 'LIVE_BOOST_STATUS',
                        sessionId,
                        platform: 'TikTok',
                        username: cleanUsername,
                        status: 'CONNECTED',
                        message: `Đã kết nối thành công phòng Live ID: ${state.roomId}`
                    });
                }).catch(err => {
                    console.error(`[TIKTOK LIVE CONNECT ERROR]:`, err.message);
                    broadcastToAll({
                        type: 'LIVE_BOOST_STATUS',
                        sessionId,
                        platform: 'TikTok',
                        username: cleanUsername,
                        status: 'ERROR',
                        message: err.message
                    });
                });

                tiktokConnection.on('roomUser', data => {
                    broadcastToAll({
                        type: 'LIVE_METRIC_UPDATE',
                        sessionId,
                        metric: 'viewers',
                        currentViewers: data.viewerCount,
                        targetViewers: targetViewersCount
                    });
                });

                tiktokConnection.on('like', data => {
                    broadcastToAll({
                        type: 'LIVE_METRIC_UPDATE',
                        sessionId,
                        metric: 'likes',
                        totalLikes: data.totalLikeCount,
                        likeCount: data.likeCount,
                        sender: data.nickname
                    });
                });

                tiktokConnection.on('chat', data => {
                    broadcastToAll({
                        type: 'LIVE_METRIC_UPDATE',
                        sessionId,
                        metric: 'comments',
                        commentUser: data.nickname,
                        commentText: data.comment
                    });
                });

                tiktokConnection.on('social', data => {
                    let metricType = 'social';
                    if (data.displayType && data.displayType.includes('share')) {
                        metricType = 'shares';
                    } else if (data.displayType && data.displayType.includes('follow')) {
                        metricType = 'follows';
                    }
                    broadcastToAll({
                        type: 'LIVE_METRIC_UPDATE',
                        sessionId,
                        metric: metricType,
                        user: data.nickname,
                        actionType: data.displayType
                    });
                });

                tiktokConnection.on('streamEnd', () => {
                    broadcastToAll({
                        type: 'LIVE_BOOST_STATUS',
                        sessionId,
                        platform: 'TikTok',
                        username: cleanUsername,
                        status: 'DISCONNECTED',
                        message: 'Phiên live đã kết thúc.'
                    });
                });

                activeLiveMonitors.set(sessionId, {
                    sessionId,
                    connection: tiktokConnection,
                    platform: 'TikTok',
                    username: cleanUsername,
                    targetViewers: targetViewersCount,
                    startTime: new Date().toLocaleTimeString('vi-VN')
                });

            } catch (err) {
                console.error('[TIKTOK INIT ERROR]:', err);
            }
        } else {
            let currentViewers = Math.floor(Math.random() * 20) + 10;
            
            const interval = setInterval(() => {
                if (!activeLiveMonitors.has(sessionId)) {
                    clearInterval(interval);
                    return;
                }

                if (currentViewers < targetViewersCount) {
                    currentViewers += Math.floor(Math.random() * 15) + 5;
                    if (currentViewers > targetViewersCount) currentViewers = targetViewersCount;
                } else {
                    currentViewers += Math.floor(Math.random() * 5) - 2;
                }

                broadcastToAll({
                    type: 'LIVE_METRIC_UPDATE',
                    sessionId,
                    metric: 'viewers',
                    currentViewers,
                    targetViewers: targetViewersCount,
                    platform,
                    targetUrl: targetUrl || username
                });
            }, 2500);

            activeLiveMonitors.set(sessionId, {
                sessionId,
                interval,
                platform,
                targetUrl: targetUrl || username,
                targetViewers: targetViewersCount,
                startTime: new Date().toLocaleTimeString('vi-VN')
            });
        }

        res.json({
            success: true,
            sessionId,
            message: `🚀 Đã khởi chạy hệ thống tăng tương tác Live cho ${platform} thành công!`
        });
    } catch (e) {
        console.error('[LIVE START ERROR]:', e);
        res.status(500).json({ success: false, error: 'Lỗi server khi khởi chạy Live Boost' });
    }
});

app.post('/api/live/stop-boost', (req, res) => {
    try {
        const { sessionId } = req.body;
        if (!sessionId || !activeLiveMonitors.has(sessionId)) {
            return res.status(404).json({ success: false, error: 'Không tìm thấy phiên Live đang chạy' });
        }

        const monitor = activeLiveMonitors.get(sessionId);
        if (monitor.connection && typeof monitor.connection.disconnect === 'function') {
            monitor.connection.disconnect();
        }
        if (monitor.interval) {
            clearInterval(monitor.interval);
        }

        activeLiveMonitors.delete(sessionId);

        broadcastToAll({
            type: 'LIVE_SESSION_STOPPED',
            sessionId,
            message: `Đã dừng phiên boost ${sessionId}`
        });

        res.json({ success: true, message: `Đã dừng thành công phiên ${sessionId}` });
    } catch (e) {
        console.error('[LIVE STOP ERROR]:', e);
        res.status(500).json({ success: false, error: 'Lỗi dừng phiên Live' });
    }
});

app.get('/api/live/sessions', (req, res) => {
    const list = Array.from(activeLiveMonitors.values()).map(m => ({
        sessionId: m.sessionId,
        platform: m.platform,
        username: m.username || '',
        targetUrl: m.targetUrl || '',
        targetViewers: m.targetViewers,
        startTime: m.startTime
    }));
    res.json({ success: true, sessions: list });
});

// ==========================================
// 🔌 REALTIME ENGINE 1: NATIVE WEBSOCKET (SLAVE & BOT HUB)
// ==========================================
wss.on('connection', (ws) => {
    ws.isAlive = true;
    let currentSlaveId = null;

    console.log('[WS] Slave/Device client đã kết nối.');

    ws.send(JSON.stringify({ 
        type: 'INIT_STATE', 
        data: {
            botCount: activeBots.size,
            slaveCount: activeSlaves.size,
            liveCount: activeLiveMonitors.size
        },
        message: 'Kết nối thành công tới WebSocket Hub!' 
    }));

    ws.on('pong', () => { ws.isAlive = true; });

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            const now = Date.now();

            if (data.type === 'PING') {
                ws.send(JSON.stringify({ type: 'PONG', timestamp: data.timestamp }));
                return;
            }

            if (data.action === 'SYNC_REGISTER_TAB') {
                currentSlaveId = data.value?.id || ('slave_' + Math.random().toString(36).substring(2, 8));
                ws.slaveId = currentSlaveId;
                activeSlaves.set(currentSlaveId, {
                    ws: ws, id: currentSlaveId,
                    name: data.value?.name || 'Khách',
                    role: data.value?.role || 'VIP_BOT',
                    isOnLive: 1, url: '', lastSeen: now
                });
            } else if (data.action === 'SYNC_STATUS') {
                currentSlaveId = data.slaveId;
                if (activeSlaves.has(currentSlaveId)) {
                    let slave = activeSlaves.get(currentSlaveId);
                    slave.name = data.nickname || slave.name;
                    slave.isOnLive = data.is_on_live;
                    slave.url = data.url;
                    slave.lastSeen = now;
                }
            } else if (data.action === 'CREATE_BOT') {
                activeBots.set(data.botId, {
                    botId: data.botId,
                    account: data.account,
                    status: data.status || 'RUNNING',
                    timestamp: data.timestamp || new Date().toLocaleTimeString('vi-VN')
                });
                broadcastToAll({ type: 'BOT_COUNT_UPDATED', count: activeBots.size });
            }

            wss.clients.forEach((client) => {
                if (client !== ws && client.readyState === WebSocket.OPEN) {
                    client.send(JSON.stringify({ type: 'BROADCAST', data }));
                }
            });
        } catch (e) {
            console.error('[WS ERROR]: Lỗi xử lý message', e);
        }
    });

    ws.on('close', () => {
        if (ws.slaveId && activeSlaves.has(ws.slaveId)) {
            activeSlaves.delete(ws.slaveId);
        }
        console.log('[WS] Slave Client ngắt kết nối.');
    });
});

// ==========================================
// ⚡ REALTIME ENGINE 2: SOCKET.IO (DASHBOARD LATENCY & EVENT SYNC)
// ==========================================
io.on('connection', (socket) => {
    console.log(`[Socket.IO] Admin Panel kết nối: ${socket.id}`);

    socket.on('latency_ping', (timestamp) => {
        socket.emit('latency_pong', timestamp);
    });

    socket.on('toggle_bot', (botId) => {
        if (activeBots.has(botId)) {
            const bot = activeBots.get(botId);
            bot.status = bot.status === 'RUNNING' ? 'STOPPED' : 'RUNNING';
            io.emit('bot_updated', Array.from(activeBots.values()));
        }
    });

    socket.on('disconnect', () => {
        console.log(`[Socket.IO] Admin Panel ngắt kết nối: ${socket.id}`);
    });
});

// Heartbeat kiểm tra kết nối đứt đối với Native WS
setInterval(() => {
    wss.clients.forEach((ws) => {
        if (ws.isAlive === false) return ws.terminate();
        ws.isAlive = false;
        ws.ping();
    });
}, 30000);

// ==========================================
// 🚀 SERVER INITIALIZATION
// ==========================================
server.listen(PORT, () => {
    console.log(`===================================================`);
    console.log(`🚀 MASTER CONTROL PANEL - HENDY & HADES V6100 PRO`);
    console.log(`📡 Server đang chạy trên port: ${PORT}`);
    console.log(`🔗 Web Dashboard: http://localhost:${PORT}`);
    console.log(`⚡ WebSocket Endpoint: ws://localhost:${PORT}/ws`);
    console.log(`===================================================`);
});
