require('dotenv').config();
const express = require('express');
const http = require('http');
const cors = require('cors');
const path = require('path');
const https = require('https');
const { WebSocketServer, WebSocket } = require('ws');

const app = express();
const PORT = process.env.PORT || 3000;

// Cấu hình Telegram Bot từ biến môi trường
const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || '';

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Trạng thái dữ liệu hệ thống tập trung
let globalState = {
    botCount: 12,
    subtitles: [],
    systemLogs: [],
    lastTelegramUpdate: null
};

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

// -------------------------------------------------------------
// 1. HAM TƯƠNG TÁC TELEGRAM BOT API
// -------------------------------------------------------------
function sendTelegramMessage(text) {
    if (!TELEGRAM_TOKEN || !TELEGRAM_CHAT_ID) {
        console.warn('[TELEGRAM] Chưa cấu hình TELEGRAM_BOT_TOKEN hoặc TELEGRAM_CHAT_ID trong .env');
        return;
    }

    const data = JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        text: text,
        parse_mode: 'HTML'
    });

    const options = {
        hostname: 'api.telegram.org',
        port: 443,
        path: `/bot${TELEGRAM_TOKEN}/sendMessage`,
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(data)
        }
    };

    const req = https.request(options, (res) => {
        res.on('data', () => {});
    });

    req.on('error', (e) => console.error('[TELEGRAM ERROR]', e.message));
    req.write(data);
    req.end();
}

// -------------------------------------------------------------
// 2. WEBSOCKET BROADCAST & SYNC ENGINE
// -------------------------------------------------------------
function broadcast(data, senderWs = null) {
    const payload = JSON.stringify(data);
    wss.clients.forEach((client) => {
        if (client !== senderWs && client.readyState === WebSocket.OPEN) {
            client.send(payload);
        }
    });
}

wss.on('connection', (ws, req) => {
    const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    console.log(`[+] V6100 Dashboard kết nối từ IP: ${clientIp}`);

    // Gửi dữ liệu đồng bộ ban đầu cho Dashboard
    ws.send(JSON.stringify({
        type: 'INIT_STATE',
        data: globalState
    }));

    // Nhận dữ liệu từ V6100 Dashboard -> Xử lý & Gửi sang Telegram
    ws.on('message', (message) => {
        try {
            const parsed = JSON.parse(message);

            switch (parsed.type) {
                case 'PING':
                    ws.send(JSON.stringify({ type: 'PONG', timestamp: parsed.timestamp }));
                    break;

                // [V6100 -> Server -> Telegram] Dashboard phát lệnh thông báo sang Telegram
                case 'NOTIFY_TELEGRAM':
                    sendTelegramMessage(`⚠️ <b>[V6100 ALERT]</b>\n${parsed.message}`);
                    break;

                // [V6100 -> Server -> Các Dashboard khác] Đồng bộ Phụ đề
                case 'SYNC_SUBTITLES':
                    globalState.subtitles = parsed.data || [];
                    broadcast({ type: 'SUBTITLES_UPDATED', data: globalState.subtitles }, ws);
                    break;

                // [V6100 -> Server -> Telegram & Dashboard khác] Thêm Log hệ thống
                case 'ADD_LOG':
                    const logEntry = parsed.data;
                    globalState.systemLogs.push(logEntry);
                    if (globalState.systemLogs.length > 100) globalState.systemLogs.shift();
                    
                    broadcast({ type: 'NEW_LOG', data: logEntry }, ws);
                    
                    // Nếu là log quan trọng (ERROR / SUCCESS), đồng bộ ngay lên Telegram
                    if (logEntry.includes('[ERROR]') || logEntry.includes('[CRITICAL]')) {
                        sendTelegramMessage(`🔴 <b>[SYSTEM LOG ERROR]</b>\n<code>${logEntry}</code>`);
                    }
                    break;

                default:
                    console.log('[WS] Sự kiện không xác định:', parsed.type);
            }
        } catch (err) {
            console.error('[WS ERROR] Lỗi định dạng JSON:', err.message);
        }
    });

    ws.on('close', () => console.log('[-] Dashboard ngắt kết nối.'));
});

// -------------------------------------------------------------
// 3. TELEGRAM WEBHOOK (Nhận dữ liệu Telegram -> Đẩy lên V6100)
// -------------------------------------------------------------
app.post(`/telegram-webhook`, (req, res) => {
    const update = req.body;

    if (update && update.message) {
        const chatId = update.message.chat.id;
        const text = update.message.text || '';
        const user = update.message.from.username || update.message.from.first_name;

        console.log(`[TELEGRAM INCOMING] Từ @${user}: ${text}`);

        const telegramEvent = {
            user: user,
            text: text,
            timestamp: new Date().toLocaleTimeString()
        };

        globalState.lastTelegramUpdate = telegramEvent;

        // 1. Phát trực tiếp lệnh/tin nhắn Telegram lên tất cả Dashboard V6100 qua WebSocket
        broadcast({
            type: 'TELEGRAM_COMMAND',
            data: telegramEvent
        });

        // 2. Xử lý một số câu lệnh Telegram phản hồi lại
        if (text === '/status') {
            sendTelegramMessage(`🤖 <b>[V6100 STATUS]</b>\n- Active Clients: ${wss.clients.size}\n- Bot Count: ${globalState.botCount}\n- Uptime: ${Math.floor(process.uptime())}s`);
        } else if (text.startsWith('/botcount ')) {
            const count = parseInt(text.split(' ')[1]);
            if (!isNaN(count)) {
                globalState.botCount = count;
                broadcast({ type: 'BOT_COUNT_UPDATED', count: count });
                sendTelegramMessage(`✅ Đã cập nhật Bot Sessions: <b>${count}</b>`);
            }
        }
    }

    res.sendStatus(200);
});

// Route kiểm tra trạng thái
app.get('/api/status', (req, res) => {
    res.json({ status: 'online', activeClients: wss.clients.size, globalState });
});

// Heartbeat giữ kết nối
setInterval(() => {
    wss.clients.forEach((ws) => { if (ws.readyState === WebSocket.OPEN) ws.ping(); });
}, 30000);

server.listen(PORT, () => {
    console.log(`[V6100 PRO] Server đang chạy tại Cổng: ${PORT}`);
    console.log(`[TELEGRAM SYNC] Webhook Endpoint: POST /telegram-webhook`);
});
