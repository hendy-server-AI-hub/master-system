require('dotenv').config();
const express = require('express');
const http = require('http');
const cors = require('cors');
const path = require('path');
const { WebSocketServer, WebSocket } = require('ws');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Trạng thái lưu trữ tạm thời trong bộ nhớ
let globalState = {
    botCount: 12,
    subtitles: [],
    systemLogs: []
};

const server = http.createServer(app);

// Khởi tạo WebSocket Server trên đường dẫn /ws
const wss = new WebSocketServer({ server, path: '/ws' });

// Hàm phát tin nhắn đến toàn bộ Clients (Broadcast)
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
    console.log(`[+] Client kết nối từ: ${clientIp}`);

    // Gửi trạng thái ban đầu cho Client mới
    ws.send(JSON.stringify({
        type: 'INIT_STATE',
        data: globalState
    }));

    ws.on('message', (message) => {
        try {
            const parsed = JSON.parse(message);

            switch (parsed.type) {
                // Phản hồi kiểm tra Latency Ping/Pong
                case 'PING':
                    ws.send(JSON.stringify({
                        type: 'PONG',
                        timestamp: parsed.timestamp
                    }));
                    break;

                // Đồng bộ phụ đề Vietsub giữa các thiết bị
                case 'SYNC_SUBTITLES':
                    globalState.subtitles = parsed.data || [];
                    broadcast({
                        type: 'SUBTITLES_UPDATED',
                        data: globalState.subtitles
                    }, ws);
                    break;

                // Cập nhật Nhật ký hệ thống (Terminal Log)
                case 'ADD_LOG':
                    globalState.systemLogs.push(parsed.data);
                    if (globalState.systemLogs.length > 100) globalState.systemLogs.shift();
                    broadcast({
                        type: 'NEW_LOG',
                        data: parsed.data
                    });
                    break;

                default:
                    console.log('Mã sự kiện không xác định:', parsed.type);
            }
        } catch (err) {
            console.error('Lỗi giải mã JSON:', err.message);
        }
    });

    ws.on('close', () => console.log('[-] Client ngắt kết nối.'));
    ws.on('error', (err) => console.error('Lỗi WebSocket Socket:', err));
});

// Giữ kết nối (Heartbeat Ping) tránh tự động đóng kết nối trên môi trường Cloud (Railway/Heroku)
setInterval(() => {
    wss.clients.forEach((ws) => {
        if (ws.readyState === WebSocket.OPEN) ws.ping();
    });
}, 30000);

// Route HTTP kiểm tra trạng thái Server
app.get('/api/status', (req, res) => {
    res.json({
        status: 'online',
        system: 'Master Control Panel V6100 PRO',
        activeClients: wss.clients.size,
        uptime: process.uptime()
    });
});

server.listen(PORT, () => {
    console.log(`[V6100 PRO] Server đang chạy tại Cổng: ${PORT}`);
    console.log(`[V6100 PRO] Endpoint WebSocket: wss://<domain>/ws`);
});
