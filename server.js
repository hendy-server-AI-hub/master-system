require('dotenv').config();
const express = require('express');
const http = require('http');
const path = require('path');
const TelegramBot = require('node-telegram-bot-api');
const { WebSocketServer, WebSocket } = require('ws');
const fs = require('fs');
const cors = require('cors');

// ==========================================
// ⚙️ CẤU HÌNH HỆ THỐNG CƠ BẢN
// ==========================================
const PORT = process.env.PORT || 8080;
const BOT_TOKEN = process.env.BOT_TOKEN || process.env.TELEGRAM_TOKEN || '8689114890:AAFBFM0rNtZWpOtAovIPHPVQTJVp0odU1DQ';
const ADMIN_ID = process.env.ADMIN_ID || '6138197737';
const CHANNEL_ID = process.env.CHANNEL_ID || '-100xxxxxxxxx';
const INTERNAL_SECRET = process.env.INTERNAL_SECRET || 'hendy_secret_key_2026';
const SYSTEM_SECRET_TOKEN = process.env.SECRET_TOKEN || "HENDY_SECURE_TOKEN_V6100";

const BANK_CONFIG = {
    bankId: 'MB',
    accountNo: '0123456789',
    accountName: 'HENDY SYSTEM'
};

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
    const indexPath = path.join(__dirname, 'index.html');
    if (fs.existsSync(indexPath)) {
        res.sendFile(indexPath);
    } else {
        res.send('<h1>👑 HENDY V5.0 GOD TIER - CLOUD BRAIN ĐANG HOẠT ĐỘNG!</h1>');
    }
});

// ==========================================
// 🌟 BỘ NHỚ LƯU TRỮ ĐÁM MÂY (CLOUD BRAIN & DB)
// ==========================================
const CloudState = {
    tabs: {},       // Lưu thông tin tất cả các Tab đang sống
    accounts: {},   // Lưu danh sách tài khoản sếp đã nạp vào
    globalCmd: {}   // Lưu các lệnh cấu hình (Cú pháp, tỷ lệ cướp...)
};

const DB_FILE = path.join(__dirname, 'database.json');
let users = {};
let orders = {};
let adminSession = {}; 
let bot = null;

const DEFAULT_LINKED_ACCOUNTS = {
    SC88: [],
    C168: [],
    CM88: [],
    F8BET: [],
    QQ88: [],
    "78WIN": []
};

function loadDatabase() {
    try {
        if (fs.existsSync(DB_FILE)) {
            const data = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
            users = data.users || {};
            orders = data.orders || {};

            Object.keys(users).forEach(uid => {
                if (!users[uid].linkedAccounts) {
                    users[uid].linkedAccounts = JSON.parse(JSON.stringify(DEFAULT_LINKED_ACCOUNTS));
                }
                if (users[uid].balance === undefined) {
                    users[uid].balance = 50000;
                }
                if (!users[uid].orders) {
                    users[uid].orders = [];
                }
            });

            console.log(`✅ Đã tải dữ liệu: ${Object.keys(users).length} người dùng | ${Object.keys(orders).length} đơn hàng.`);
        } else {
            users = {};
            orders = {};
            saveDatabase();
        }
    } catch (err) {
        console.error('❌ Lỗi đọc database:', err.message);
        users = {};
        orders = {};
    }
}

function saveDatabase() {
    try {
        fs.writeFileSync(DB_FILE, JSON.stringify({ users, orders }, null, 4), 'utf8');
    } catch (err) {
        console.error('❌ Lỗi lưu database:', err.message);
    }
}

function generateOrderId() {
    return 'ORD' + Math.floor(Math.random() * 90000 + 10000);
}

// ==========================================
// 📦 DANH MỤC DỊCH VỤ MXH & THÔNG SỐ
// ==========================================
const SMM_SERVICES = {
    coin_master: {
        title: '🎲 SPIN COIN MASTER',
        items: [
            { name: 'Spin Coin Master', price: 1000 },
            { name: 'Spin Coin Master (Extra)', price: 1500 },
            { name: 'Sự Kiện Mời Đối Tác', price: 5000 }
        ]
    },
    facebook: {
        title: '📘 DỊCH VỤ FACEBOOK',
        items: [
            { name: 'Tăng Like Facebook', price: 100 },
            { name: 'Tăng Follow Facebook', price: 150 },
            { name: 'Tăng Lượt Xem Story', price: 50 }
        ]
    },
    tiktok: {
        title: '🎵 DỊCH VỤ TIKTOK',
        items: [
            { name: 'Tăng Tim Tiktok', price: 80 },
            { name: 'Tăng Follow Tiktok', price: 120 },
            { name: 'Tăng View Tiktok', price: 20 }
        ]
    }
};

let brandStatuses = {
    'SC88': { status: '🟢 Hoạt động', ping: 12 },
    'C168': { status: '🟢 Hoạt động', ping: 15 },
    'F8BET': { status: '🟢 Hoạt động', ping: 14 }
};

// ==========================================
// 🧠 LÕI AI ENGINE ĐIỀU KHIỂN HỆ THỐNG ĐA PHIÊN
// ==========================================
class AISessionManager {
    constructor(maxConcurrentSessions = 10) {
        this.maxConcurrent = maxConcurrentSessions;
        this.activeSessions = new Map();
        this.queue = [];
    }

    enqueueOrder(order) {
        this.queue.push(order);
        this.broadcastLog(`[AI ENGINE] Đã nhận đơn #${order.id} (${order.serviceName || order.service}) vào hàng chờ.`);
        this.processNext();
    }

    processNext() {
        if (this.activeSessions.size >= this.maxConcurrent || this.queue.length === 0) return;

        const order = this.queue.shift();
        const sessionId = `BOT_${Date.now().toString().slice(-6)}_${Math.floor(Math.random() * 100)}`;
        
        this.activeSessions.set(sessionId, {
            id: sessionId,
            orderId: order.id,
            targetLink: order.link,
            quantity: order.quantity,
            progress: 0,
            status: 'RUNNING'
        });

        if (orders[order.id]) orders[order.id].status = '⏳ Đang xử lý';
        saveDatabase();

        this.broadcastLog(`[AI ENGINE] Khởi tạo luồng ${sessionId} chạy đơn #${order.id} cho link: ${order.link}`);
        this.broadcastSessionState();
        this.runWorkerSession(sessionId, order);
    }

    async runWorkerSession(sessionId, order) {
        const session = this.activeSessions.get(sessionId);
        if (!session) return;
        const targetQty = parseInt(order.quantity) || 100;
        let completed = 0;

        const interval = setInterval(() => {
            if (completed >= targetQty) {
                clearInterval(interval);
                session.status = 'COMPLETED';
                session.progress = 100;

                if (orders[order.id]) orders[order.id].status = '✅ Hoàn thành';
                saveDatabase();

                this.broadcastLog(`[AI ENGINE] ✅ Phiên ${sessionId} hoàn thành! Đã bơm ${targetQty}`);
                this.activeSessions.delete(sessionId);
                this.broadcastSessionState();
                this.processNext();
            } else {
                const step = Math.min(Math.floor(Math.random() * 15) + 5, targetQty - completed);
                completed += step;
                session.progress = Math.round((completed / targetQty) * 100);
                this.broadcastSessionState();
            }
        }, 2000);
    }

    broadcastLog(message) {
        this.emitToWS({ type: 'AI_SYSTEM_LOG', timestamp: new Date().toLocaleTimeString('vi-VN'), text: message });
    }

    broadcastSessionState() {
        this.emitToWS({ type: 'AI_SESSIONS_UPDATE', activeCount: this.activeSessions.size, sessions: Array.from(this.activeSessions.values()) });
    }

    emitToWS(payload) {
        const data = JSON.stringify(payload);
        wss.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) client.send(data);
        });
    }
}

const aiEngine = new AISessionManager(10);

// ==========================================
// 🌟 AI PHÂN PHÁT TÀI KHOẢN (CLOUD BRAIN)
// ==========================================
function distributeAccounts() {
    let availableAccs = Object.values(CloudState.accounts);
    if(availableAccs.length === 0) return;

    for (const [clientId, tabInfo] of Object.entries(CloudState.tabs)) {
        if (tabInfo && tabInfo.needsLogin) {
            let targetAcc = availableAccs.find(acc => acc.brand === tabInfo.brand && !acc.isUsed);
            if (targetAcc) {
                targetAcc.isUsed = true;
                wss.clients.forEach(c => {
                    if(c.id === clientId && c.readyState === WebSocket.OPEN) {
                        c.send(JSON.stringify({
                            action: 'DIRECT_LOGIN_ORDER',
                            account: targetAcc
                        }));
                        aiEngine.broadcastLog(`[AI ASSIGN] Đã cấp TK ${targetAcc.tk} cho Tab ${clientId}`);
                    }
                });
            }
        }
    }
}

// ==========================================
// 🌐 REST API ENDPOINTS
// ==========================================
app.get('/health', (req, res) => {
    res.json({ status: 'OK', system: 'Master Control Panel V6100 Cloud Brain' });
});

// ==========================================
// 🤖 TELEGRAM BOT SETUP
// ==========================================
function sendHomeMenu(chatId, u, isAdmin) {
    const welcomeMessage = `
🤖 *HỆ THỐNG DỊCH VỤ MXH PRO* 🚀
Chào mừng sếp, *${u.name}*
--------------------------------------------------
💎 *Phân quyền:* ${isAdmin ? '👑 ADMIN TỐI CAO' : '👤 KHÁCH HÀNG'}
💰 **Ví Chính:** \`${(u.balance || 0).toLocaleString()} VNĐ\`
--------------------------------------------------
👉 Chọn dịch vụ cần giao dịch bên dưới:
    `;
    const inlineKeyboard = [
        [{ text: '🌐 DỊCH VỤ MẠNG XÃ HỘI', callback_data: 'smm_main' }],
        [{ text: '💳 NẠP TIỀN', callback_data: 'deposit' }],
        ...(isAdmin ? [[{ text: '🛡️ TRUNG TÂM ADMIN', callback_data: 'admin_center' }]] : [])
    ];
    bot.sendMessage(chatId, welcomeMessage, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: inlineKeyboard } }).catch(() => {});
}

function setupBotLogic() {
    if (!bot) return;
    bot.onText(/\/start/, (msg) => {
        const chatId = msg.chat.id.toString();
        const user = msg.from;
        const isAdmin = (chatId === ADMIN_ID);

        if (!users[chatId]) {
            users[chatId] = { id: chatId, name: user.first_name || 'Khách', balance: 50000, orders: [], linkedAccounts: JSON.parse(JSON.stringify(DEFAULT_LINKED_ACCOUNTS)) };
            saveDatabase();
        }
        sendHomeMenu(chatId, users[chatId], isAdmin);
    });
}

function startBot(token) {
    if (!token) return false;
    try {
        bot = new TelegramBot(token, { polling: true });
        setupBotLogic();
        console.log('🤖 Bot Telegram đã khởi động thành công!');
        return true;
    } catch (e) {
        console.error("❌ Lỗi khởi động bot:", e.message);
        return false;
    }
}

// ==========================================
// 🔌 WEBSOCKET SERVER CLOUD BRAIN REALTIME
// ==========================================
wss.on('connection', (ws, req) => {
    ws.id = "TAB_" + Math.random().toString(36).substr(2, 9);
    ws.isAlive = true;
    console.log(`[+] Đàn em/Client gia nhập hệ thống: ${ws.id}`);

    ws.send(JSON.stringify({
        type: 'INIT_DATA',
        totalUsers: Object.keys(users).length,
        orders: Object.values(orders).reverse(),
        brandStatuses: brandStatuses
    }));

    ws.on('pong', () => { ws.isAlive = true; });

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            
            // 0. Xác thực Secret Token bảo mật
            if (data.token && data.token !== SYSTEM_SECRET_TOKEN) {
                ws.send(JSON.stringify({ action: 'ERROR', message: 'Sai Secret Token bảo mật!' }));
                return;
            }

            // 1. Phản hồi lệnh PING đo độ trễ
            if (data.action === 'PING' || data.type === 'PONG') {
                ws.send(JSON.stringify({ type: 'PONG', timestamp: data.timestamp || data.time }));
                return;
            }

            // 2. Đàn em khai báo danh tính (Heartbeat)
            if (data.action === 'TAB_HEARTBEAT') {
                CloudState.tabs[ws.id] = data.info;
                return;
            }

            // 3. Cập nhật kho tài khoản
            if (data.action === 'UPDATE_ACCOUNTS_POOL') {
                CloudState.accounts = data.pool;
                distributeAccounts();
                return;
            }

            // 4. Broadcast chung cho các clients khác
            wss.clients.forEach((client) => {
                if (client !== ws && client.readyState === WebSocket.OPEN) {
                    client.send(JSON.stringify(data));
                }
            });
        } catch (err) {
            console.error('[!] Lỗi băng thông WS:', err.message);
        }
    });

    ws.on('close', () => {
        console.log(`[-] Đàn em ngắt mạng: ${ws.id}`);
        delete CloudState.tabs[ws.id];
    });
});

// ==========================================
// ⚡ VÒNG LẶP SINH TỬ TỐI ƯU (15s/lần)
// ==========================================
const interval = setInterval(() => {
    wss.clients.forEach((ws) => {
        if (ws.isAlive === false) return ws.terminate();
        ws.isAlive = false;
        ws.ping();
    });
    distributeAccounts();
}, 15000);

wss.on('close', () => clearInterval(interval));

// ==========================================
// 🚀 KHỞI CHẠY SERVER
// ==========================================
server.listen(PORT, () => {
    loadDatabase();
    startBot(BOT_TOKEN);
    console.log(`👑 Master Control Panel V6100 & Cloud Brain đang chạy tại cổng ${PORT}`);
});
