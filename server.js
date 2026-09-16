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
const activeBots = new Map(); // Quản lý danh sách Bot động
const activeLiveMonitors = new Map(); // Quản lý các phiên Live Stream đang tăng mắt / theo dõi

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.static(__dirname));

// Hàm hỗ trợ phát sóng dữ liệu đến tất cả Client đang kết nối WebSocket
function broadcastToAll(data) {
    const payload = typeof data === 'string' ? data : JSON.stringify(data);
    wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(payload);
        }
    });
}

// ==========================================
// 🤖 AI MANAGER ENGINE (BỘ TRÍ TUỆ NHÂN TẠO QUẢN LÝ)
// ==========================================
async function processAiManagerCommand(userPrompt, systemContext) {
    const prompt = userPrompt.toLowerCase().trim();
    
    // Nếu có Cấu hình Gemini API Key -> Gọi API của Google Gemini
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

Hãy phân tích lệnh và trả về DUY NHẤT một chuỗi JSON theo định dạng chuẩn sau (không thêm văn bản ngoài JSON):
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

    // Bộ quy tắc AI Local Engine (Fallback hoạt động offline / không cần API Key)
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
        reply = `📊 BÁO CÁO SỨC KHỎE HỆ THỐNG:\n- Số Slave đang kết nối: ${systemContext.slaveCount || 0}\n- Số Bot đang lưu trữ: ${systemContext.botCount || 0}\n- Số Phiên Live đang boost: ${systemContext.liveCount || 0}\n- WebSocket Hub: ONLINE 🟢`;
    }

    return { action, reply, params };
}

// API Tiếp nhận lệnh từ AI Manager
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

        // Broadcast hành động của AI qua WebSocket tới toàn bộ các Client
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
// 🔴 LIVE STREAM VIEWER ENGINE (BỘ TĂNG & THEO DÕI MẮT LIVE)
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
                        type: 'LIVE_VIEWER_UPDATE',
                        sessionId,
                        platform: 'TikTok',
                        username: cleanUsername,
                        currentViewers: data.viewerCount,
                        targetViewers: targetViewersCount
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

                // Tăng dần số người xem theo tiến trình mượt mà
                if (currentViewers < targetViewersCount) {
                    currentViewers += Math.floor(Math.random() * 15) + 5;
                    if (currentViewers > targetViewersCount) currentViewers = targetViewersCount;
                } else {
                    currentViewers += Math.floor(Math.random() * 5) - 2;
                }

                broadcastToAll({
                    type: 'LIVE_VIEWER_UPDATE',
                    sessionId,
                    platform,
                    targetUrl: targetUrl || username,
                    currentViewers,
                    targetViewers: targetViewersCount
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
            message: `🚀 Đã khởi chạy tiến trình tăng người xem cho ${platform} thành công!`
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

// APIs Hiện tại của Hệ thống
app.get('/api/slaves', (req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    let slavesList = [];
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
    res.end(JSON.stringify(slavesList, null, 2));
});

app.get('/api/bots', (req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(Array.from(activeBots.values()), null, 2));
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

// WebSocket Event Listener
wss.on('connection', (ws) => {
    clients.add(ws);
    ws.isAlive = true;
    let currentSlaveId = null;
    
    console.log('[WS] Client đã kết nối thành công.');
    
    // Gửi trạng thái khởi tạo khi kết nối
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
            console.log('[WS RECV]:', data);

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
                console.log(`[BOT CREATED] ID: ${data.botId} | Acc: ${data.account}`);
                broadcastToAll({ type: 'BOT_COUNT_UPDATED', count: activeBots.size });
            }

            // Broadcast dữ liệu/lệnh tới tất cả Client WebSocket khác
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
        clients.delete(ws);
        if (ws.slaveId && activeSlaves.has(ws.slaveId)) {
            activeSlaves.delete(ws.slaveId);
        }
        console.log('[WS] Client đã ngắt kết nối.');
    });
});

server.listen(PORT, () => {
    console.log(`🚀 [HENDY SERVER HUB] Đang chạy tại cổng: ${PORT}`);
});
