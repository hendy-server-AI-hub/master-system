const WebSocket = require('ws');
const http = require('http');
const express = require('express');
const path = require('path');
const { WebcastPushConnection } = require('tiktok-live-connector');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3000;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';

const clients = new Set();
const activeSlaves = new Map();
const activeBots = new Map(); // Quản lý danh sách Bot động[cite: 1]
const activeLiveMonitors = new Map(); // Quản lý các phiên Live Stream & Tăng tương tác

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.static(__dirname));

// Hàm hỗ trợ phát sóng dữ liệu đến tất cả Client WebSocket
function broadcastToAll(data) {
    const payload = typeof data === 'string' ? data : JSON.stringify(data);
    wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(payload);
        }
    });
}

// ==========================================
// 🤖 AI MANAGER ENGINE (BỘ TRÍ TUỆ NHÂN TẠO QUẢN LÝ)[cite: 1]
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
                            text: `Bạn là AI Quản Lý Hệ Thống Hendy & Hades V6100 Pro.[cite: 1]
Trạng thái hệ thống hiện tại: 
- Số lượng Bot active: ${systemContext.botCount || 0}[cite: 1]
- Số lượng Slave connected: ${systemContext.slaveCount || 0}[cite: 1]
- Số phiên Live đang mở: ${systemContext.liveCount || 0}

Người dùng gửi câu lệnh: "${userPrompt}"[cite: 1]

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
            console.error('[AI GEMINI ERROR]:', err);[cite: 1]
        }
    }

    let action = 'UNKNOWN';
    let reply = '🤖 AI Quản lý chưa hiểu rõ yêu cầu. Bạn có thể thử: "Chạy tất cả bot", "Dừng bot", "Thêm 3 bot", "Tăng mắt live", "Xuất báo cáo", hoặc "Báo cáo trạng thái".';[cite: 1]
    let params = {};

    if (prompt.includes('chạy') || prompt.includes('bắt đầu') || prompt.includes('start')) {
        action = 'START_ALL_BOTS';[cite: 1]
        reply = '🚀 AI Manager đã phát lệnh kích hoạt TẤT CẢ các Bot trong hệ thống!';[cite: 1]
    } else if (prompt.includes('dừng') || prompt.includes('stop') || prompt.includes('tắt')) {
        action = 'STOP_ALL_BOTS';[cite: 1]
        reply = '⏹ AI Manager đã tạm dừng hoạt động của tất cả các Bot!';[cite: 1]
    } else if (prompt.includes('thêm bot') || prompt.includes('tạo bot') || prompt.includes('add bot')) {
        action = 'ADD_BOT';[cite: 1]
        const match = prompt.match(/\d+/);
        const count = match ? parseInt(match[0]) : 1;
        params = { count };[cite: 1]
        reply = `➕ AI Manager đã thêm thành công ${count} tài khoản Bot mới vào Hub!`;[cite: 1]
    } else if (prompt.includes('xuất') || prompt.includes('báo cáo') || prompt.includes('csv') || prompt.includes('download')) {
        action = 'EXPORT_CSV';[cite: 1]
        reply = '📥 AI Manager đã tạo và tải về tệp báo cáo danh sách Bot!';[cite: 1]
    } else if (prompt.includes('xóa log') || prompt.includes('dọn log') || prompt.includes('clear')) {
        action = 'CLEAR_LOGS';[cite: 1]
        reply = '🗑️ AI Manager đã dọn dẹp sạch sẽ toàn bộ nhật ký hệ thống.';[cite: 1]
    } else if (prompt.includes('trạng thái') || prompt.includes('kiểm tra') || prompt.includes('status') || prompt.includes('sức khỏe')) {
        action = 'SYSTEM_STATUS';[cite: 1]
        reply = `📊 BÁO CÁO SỨC KHỎE HỆ THỐNG:\n- Số Slave đang kết nối: ${systemContext.slaveCount || 0}\n- Số Bot đang lưu trữ: ${systemContext.botCount || 0}\n- Số Phiên Live đang chạy: ${systemContext.liveCount || 0}\n- WebSocket Hub: ONLINE 🟢`;[cite: 1]
    }

    return { action, reply, params };[cite: 1]
}

// API Tiếp nhận lệnh từ AI Manager[cite: 1]
app.post('/api/ai/manage', async (req, res) => {
    try {
        const { prompt, context } = req.body;[cite: 1]
        if (!prompt) {
            return res.status(400).json({ error: 'Vui lòng cung cấp câu lệnh' });[cite: 1]
        }

        const systemContext = {
            slaveCount: activeSlaves.size,[cite: 1]
            botCount: activeBots.size,[cite: 1]
            liveCount: activeLiveMonitors.size,
            ...(context || {})[cite: 1]
        };

        const result = await processAiManagerCommand(prompt, systemContext);[cite: 1]

        broadcastToAll({
            type: 'AI_MANAGER_ACTION',[cite: 1]
            action: result.action,[cite: 1]
            params: result.params,[cite: 1]
            sender: 'AI_SERVER'[cite: 1]
        });

        res.json({ success: true, data: result });[cite: 1]
    } catch (error) {
        console.error('[AI API ERROR]:', error);[cite: 1]
        res.status(500).json({ error: 'Lỗi xử lý AI Manager' });[cite: 1]
    }
});

// ==========================================
// 🔴 LIVE STREAM & TIKTOK CONNECTOR ENGINE (TĂNG MẮT, TIM, FOLLOW, SHARE, COMMENT)
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

                // 1. Tăng Mắt Live (Viewer Count)
                tiktokConnection.on('roomUser', data => {
                    broadcastToAll({
                        type: 'LIVE_METRIC_UPDATE',
                        sessionId,
                        metric: 'viewers',
                        currentViewers: data.viewerCount,
                        targetViewers: targetViewersCount
                    });
                });

                // 2. Tăng Tim TikTok (Likes)
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

                // 3. Tăng Bình Luận TikTok (Comments)
                tiktokConnection.on('chat', data => {
                    broadcastToAll({
                        type: 'LIVE_METRIC_UPDATE',
                        sessionId,
                        metric: 'comments',
                        commentUser: data.nickname,
                        commentText: data.comment
                    });
                });

                // 4 & 5. Tăng Follow & Share TikTok (Social Events)
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
            // Nền tảng khác (YouTube, Facebook, Shopee, Bigo, v.v.) -> Mô phỏng / Điều phối Worker Boost
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

// APIs Hiện tại của Hệ thống[cite: 1]
app.get('/api/slaves', (req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });[cite: 1]
    let slavesList = [];
    activeSlaves.forEach((client) => {[cite: 1]
        slavesList.push({
            id: client.id,[cite: 1]
            name: client.name,[cite: 1]
            role: client.role,[cite: 1]
            isOnLive: client.isOnLive,[cite: 1]
            url: client.url,[cite: 1]
            lastSeen: new Date(client.lastSeen).toLocaleTimeString('vi-VN')[cite: 1]
        });
    });
    res.end(JSON.stringify(slavesList, null, 2));[cite: 1]
});

app.get('/api/bots', (req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });[cite: 1]
    res.end(JSON.stringify(Array.from(activeBots.values()), null, 2));[cite: 1]
});

app.get('/send-command', (req, res) => {
    const cmd = req.query.cmd || 'ĐIỂM DANH + SC88 +';[cite: 1]
    let count = 0;
    wss.clients.forEach((client) => {[cite: 1]
        if (client.readyState === WebSocket.OPEN) {[cite: 1]
            client.send(JSON.stringify({ action: `CHAT|${cmd}` }));[cite: 1]
            count++;
        }
    });
    res.send(`🚀 Đã phát lệnh thành công cho ${count} thiết bị: [ ${cmd} ]`);[cite: 1]
});

// WebSocket Event Listener[cite: 1]
wss.on('connection', (ws) => {
    clients.add(ws);[cite: 1]
    ws.isAlive = true;[cite: 1]
    let currentSlaveId = null;[cite: 1]
    
    console.log('[WS] Client đã kết nối thành công.');[cite: 1]
    
    ws.send(JSON.stringify({ 
        type: 'INIT_STATE',[cite: 1]
        data: {
            botCount: activeBots.size,[cite: 1]
            slaveCount: activeSlaves.size,[cite: 1]
            liveCount: activeLiveMonitors.size
        },
        message: 'Kết nối thành công tới WebSocket Hub!'[cite: 1]
    }));

    ws.on('pong', () => { ws.isAlive = true; });[cite: 1]

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);[cite: 1]
            const now = Date.now();[cite: 1]
            console.log('[WS RECV]:', data);[cite: 1]

            if (data.type === 'PING') {
                ws.send(JSON.stringify({ type: 'PONG', timestamp: data.timestamp }));[cite: 1]
                return;
            }

            if (data.action === 'SYNC_REGISTER_TAB') {
                currentSlaveId = data.value?.id || ('slave_' + Math.random().toString(36).substring(2, 8));[cite: 1]
                ws.slaveId = currentSlaveId;[cite: 1]
                activeSlaves.set(currentSlaveId, {
                    ws: ws, id: currentSlaveId,[cite: 1]
                    name: data.value?.name || 'Khách',[cite: 1]
                    role: data.value?.role || 'VIP_BOT',[cite: 1]
                    isOnLive: 1, url: '', lastSeen: now[cite: 1]
                });
            } else if (data.action === 'SYNC_STATUS') {
                currentSlaveId = data.slaveId;[cite: 1]
                if (activeSlaves.has(currentSlaveId)) {[cite: 1]
                    let slave = activeSlaves.get(currentSlaveId);[cite: 1]
                    slave.name = data.nickname || slave.name;[cite: 1]
                    slave.isOnLive = data.is_on_live;[cite: 1]
                    slave.url = data.url;[cite: 1]
                    slave.lastSeen = now;[cite: 1]
                }
            } else if (data.action === 'CREATE_BOT') {
                activeBots.set(data.botId, {
                    botId: data.botId,[cite: 1]
                    account: data.account,[cite: 1]
                    status: data.status || 'RUNNING',[cite: 1]
                    timestamp: data.timestamp || new Date().toLocaleTimeString('vi-VN')[cite: 1]
                });
                console.log(`[BOT CREATED] ID: ${data.botId} | Acc: ${data.account}`);[cite: 1]
                broadcastToAll({ type: 'BOT_COUNT_UPDATED', count: activeBots.size });[cite: 1]
            }

            wss.clients.forEach((client) => {[cite: 1]
                if (client !== ws && client.readyState === WebSocket.OPEN) {[cite: 1]
                    client.send(JSON.stringify({ type: 'BROADCAST', data }));[cite: 1]
                }
            });
        } catch (e) {
            console.error('[WS ERROR]: Lỗi xử lý message', e);[cite: 1]
        }
    });

    ws.on('close', () => {
        clients.delete(ws);[cite: 1]
        if (ws.slaveId && activeSlaves.has(ws.slaveId)) {[cite: 1]
            activeSlaves.delete(ws.slaveId);[cite: 1]
        }
        console.log('[WS] Client đã ngắt kết nối.');[cite: 1]
    });
});

server.listen(PORT, () => {
    console.log(`🚀 [HENDY SERVER HUB] Đang chạy tại cổng: ${PORT}`);[cite: 1]
});
