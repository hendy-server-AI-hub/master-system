const express = require('express');
const http = require('http');
const { WebSocketServer, WebSocket } = require('ws');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Phục vụ file giao diện HTML tĩnh
app.use(express.static(path.join(__dirname, 'public')));

const server = http.createServer(app);

// Khởi tạo WebSocket Server trên đường dẫn /ws
const wss = new WebSocketServer({ server, path: '/ws' });

// Lưu trữ bộ nhớ tạm thời cho dữ liệu đồng bộ
let globalState = {
    botCount: 12,
    subtitles: [],
    systemLogs: []
};

// Hàm gửi dữ liệu tới tất cả các client đang kết nối (Broadcast)
function broadcast(data, senderWs = null) {
    const payload = JSON.stringify(data);
    wss.clients.forEach((client) => {
        if (client !== senderWs && client.readyState === WebSocket.OPEN) {
            client.send(payload);
        }
    });
}

wss.on('connection', (ws, req) => {
    console.log(`[+] Client kết nối mới từ IP: ${req.socket.remoteAddress}`);

    // Gửi trạng thái ban đầu ngay khi Client kết nối thành công
    ws.send(JSON.stringify({
        type: 'INIT_STATE',
        data: globalState
    }));

    ws.on('message', (message) => {
        try {
            const parsed = JSON.parse(message);

            switch (parsed.type) {
                // 1. Phản hồi kiểm tra Latency (Ping/Pong)
                case 'PING':
                    ws.send(JSON.stringify({
                        type: 'PONG',
                        timestamp: parsed.timestamp
                    }));
                    break;

                // 2. Đồng bộ danh sách Phụ đề Vietsub giữa các tab/thiết bị
                case 'SYNC_SUBTITLES':
                    globalState.subtitles = parsed.data;
                    broadcast({
                        type: 'SUBTITLES_UPDATED',
                        data: globalState.subtitles
                    }, ws);
                    break;

                // 3. Đồng bộ Cài đặt / Nhật ký Hệ thống (Terminal Logs)
                case 'ADD_LOG':
                    globalState.systemLogs.push(parsed.data);
                    broadcast({
                        type: 'NEW_LOG',
                        data: parsed.data
                    });
                    break;

                default:
                    console.log('Tin nhắn không xác định:', parsed);
            }
        } catch (err) {
            console.error('Lỗi xử lý dữ liệu JSON:', err.message);
        }
    });

    ws.on('close', () => {
        console.log('[-] Client ngắt kết nối.');
    });

    ws.on('error', (error) => {
        console.error('Lỗi Socket:', error);
    });
});

// Giữ kết nối (Heartbeat) định kỳ tránh timeout của Railway / Heroku
setInterval(() => {
    wss.clients.forEach((ws) => {
        if (ws.readyState === WebSocket.OPEN) {
            ws.ping();
        }
    });
}, 30000);

server.listen(PORT, () => {
    console.log(`[SUCCESS] V6100 Server đang chạy tại cổng: ${PORT}`);
    console.log(`[WS ENDPOINT] wss://<domain>/ws`);
});
