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
// 🗄️ QUẢN LÝ DATABASE (USERS & ORDERS)
// ==========================================
const DB_FILE = path.join(__dirname, 'database.json');
let users = {};
let orders = {};
let adminSession = {}; 
let bot = null;

// 🌟 BỘ NHỚ LƯU TRỮ ĐÁM MÂY (CLOUD BRAIN) 🌟
const CloudState = {
    tabs: {},       // Lưu thông tin tất cả các Tab đang sống
    accounts: {},   // Lưu danh sách tài khoản sếp đã nạp vào
    globalCmd: {}   // Lưu các lệnh cấu hình (Cú pháp, tỷ lệ cướp...)
};

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

            Object.values(users).forEach(u => {
                if (Array.isArray(u.orders)) {
                    u.orders.forEach(o => {
                        if (o.id && !orders[o.id]) {
                            orders[o.id] = o;
                        }
                    });
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
            { name: 'Tăng Lượt Xem Story', price: 50 },
            { name: 'Tăng Share Bài Viết', price: 200 },
            { name: 'Tăng Like / Follow Fanpage', price: 180 },
            { name: 'Tăng View Live Stream', price: 300 },
            { name: 'Tăng Member Facebook', price: 120 },
            { name: 'Tăng Bình Luận Facebook', price: 250 },
            { name: 'Tăng Lượt Xem Video', price: 40 }
        ]
    },
    tiktok: {
        title: '🎵 DỊCH VỤ TIKTOK',
        items: [
            { name: 'Tăng Tim Tiktok', price: 80 },
            { name: 'Tăng Follow Tiktok', price: 120 },
            { name: 'Tăng View Tiktok', price: 20 },
            { name: 'Tăng Share Tiktok', price: 100 },
            { name: 'Tăng Save Tiktok', price: 90 },
            { name: 'Tăng Bình Luận Tiktok', price: 200 },
            { name: 'Tăng Mắt Live Tiktok', price: 350 }
        ]
    },
    instagram: {
        title: '📸 DỊCH VỤ INSTAGRAM',
        items: [
            { name: 'Tăng Tim Bài Viết INS', price: 90 },
            { name: 'Tăng Theo Dõi Instagram', price: 140 }
        ]
    },
    youtube: {
        title: '▶️ DỊCH VỤ YOUTUBE',
        items: [
            { name: 'Tăng Subscribe Youtube', price: 300 },
            { name: 'Tăng View Youtube', price: 50 },
            { name: 'Tăng Like Youtube', price: 100 }
        ]
    },
    shopee: {
        title: '🛍️ DỊCH VỤ SHOPEE',
        items: [
            { name: 'Tăng Theo Dõi Shopee', price: 150 },
            { name: 'Tăng Tim Shopee', price: 80 },
            { name: 'Tăng Mắt Live Shopee', price: 400 }
        ]
    },
    twitter_x: {
        title: '𝕏 DỊCH VỤ X (TWITTER)',
        items: [
            { name: 'Tăng Like X', price: 110 },
            { name: 'Tăng Follow X', price: 160 },
            { name: 'Tăng Lượt Xem X', price: 30 }
        ]
    },
    bigo: {
        title: '🐥 DỊCH VỤ BIGO LIVE',
        items: [
            { name: 'Tăng Mắt Xem Bigo Live', price: 500 }
        ]
    },
    telegram: {
        title: '✈️ DỊCH VỤ TELEGRAM',
        items: [
            { name: 'Tăng Member Telegram Group/Channel', price: 130 },
            { name: 'Tăng View Bài Viết Telegram', price: 25 }
        ]
    },
    thread: {
        title: '🌀 DỊCH VỤ THREAD',
        items: [
            { name: 'Tăng Follow Thread', price: 150 },
            { name: 'Tăng Like Thread', price: 100 }
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

        if (orders[order.id]) {
            orders[order.id].status = '⏳ Đang xử lý';
        }
        if (users[order.chatId] && Array.isArray(users[order.chatId].orders)) {
            const uOrder = users[order.chatId].orders.find(o => o.id === order.id);
            if (uOrder) uOrder.status = '⏳ Đang xử lý';
        }
        saveDatabase();

        this.broadcastLog(`[AI ENGINE] Khởi tạo luồng ${sessionId} chạy đơn #${order.id} cho link: ${order.link}`);
        this.broadcastSessionState();
        this.broadcastOrderUpdate();
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

                if (orders[order.id]) {
                    orders[order.id].status = '✅ Hoàn thành';
                }
                if (users[order.chatId] && Array.isArray(users[order.chatId].orders)) {
                    const uOrder = users[order.chatId].orders.find(o => o.id === order.id);
                    if (uOrder) uOrder.status = '✅ Hoàn thành';
                }
                saveDatabase();

                this.broadcastLog(`[AI ENGINE] ✅ Phiên ${sessionId} hoàn thành! Đã bơm ${targetQty} cho ${order.link}`);
                this.broadcastOrderUpdate();
                
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

    broadcastOrderUpdate() {
        this.emitToWS({ type: 'ORDERS_UPDATED', orders: Object.values(orders).reverse() });
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
        if (tabInfo.needsLogin) {
            let targetAcc = availableAccs.find(acc => acc.brand === tabInfo.brand && !acc.isUsed);
            if (targetAcc) {
                targetAcc.isUsed = true;
                wss.clients.forEach(c => {
                    if(c.id === clientId && c.readyState === WebSocket.OPEN) {
                        c.send(JSON.stringify({
                            action: 'DIRECT_LOGIN_ORDER',
                            account: targetAcc
                        }));
                        console.log(`[🚀 AI ASSIGN] Đã cấp TK ${targetAcc.tk} cho Tab ${clientId}`);
                    }
                });
            }
        }
    }
}

// ==========================================
// 🌐 REST API & PUPPETEER CRAWL ENDPOINTS
// ==========================================
const verifyInternalSecret = (req, res, next) => {
    const secret = req.headers['x-internal-secret'] || req.headers['X-Internal-Secret'];
    if (!secret || secret !== INTERNAL_SECRET) {
        return res.status(403).json({ error: 'Unauthorized request from Edge Worker' });
    }
    next();
};

app.get('/health', (req, res) => {
    res.json({ status: 'OK', system: 'Master Control Panel V6100' });
});

app.post('/api/smm/run-puppeteer', verifyInternalSecret, async (req, res) => {
    const { targetUrl, chatId } = req.body;
    if (!targetUrl) {
        return res.status(400).json({ success: false, error: 'Target URL is required' });
    }

    let browser = null;
    try {
        aiEngine.broadcastLog(`[PUPPETEER] Bắt đầu cào dữ liệu cho URL: ${targetUrl} (ChatID: ${chatId || 'API'})`);
        
        let puppeteer;
        try {
            puppeteer = require('puppeteer');
        } catch (e) {
            return res.status(500).json({ success: false, error: 'Thư viện Puppeteer chưa được cài đặt trên Backend.' });
        }

        browser = await puppeteer.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
        });
        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        
        await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: 30000 });
        
        const pageTitle = await page.title();
        const metaDescription = await page.$eval('meta[name="description"]', el => el.content).catch(() => 'Không có mô tả');
        
        const extractedData = {
            title: pageTitle,
            description: metaDescription,
            url: targetUrl,
            scrapedAt: new Date().toISOString()
        };

        await browser.close();
        aiEngine.broadcastLog(`[PUPPETEER] ✅ Cào thành công trang: ${pageTitle}`);
        return res.json({ success: true, data: extractedData });

    } catch (err) {
        if (browser) await browser.close().catch(() => {});
        aiEngine.broadcastLog(`[PUPPETEER ERROR] ${err.message}`);
        return res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/ai/run-all', (req, res) => {
    let count = 0;
    Object.values(orders).forEach(order => {
        if (order.status === 'Đang chờ' || order.status === 'Pending') {
            aiEngine.enqueueOrder(order);
            count++;
        }
    });
    res.json({ success: true, message: `Đã đẩy ${count} đơn vào hệ thống AI đa phiên.` });
});

app.post('/api/broadcast', async (req, res) => {
    const { message } = req.body;
    if (!message) return res.status(400).json({ error: 'Nội dung không được để trống' });
    let success = 0, fail = 0;
    if (bot) {
        for (const chatId of Object.keys(users)) {
            try {
                await bot.sendMessage(chatId, `📢 *THÔNG BÁO TỪ HỆ THỐNG*\n\n${message}`, { parse_mode: 'Markdown' });
                success++;
            } catch (e) { fail++; }
        }
    }
    aiEngine.broadcastLog(`[BROADCAST] Đã gửi thông báo tới ${success} user (${fail} lỗi).`);
    res.json({ success: true, successCount: success, failCount: fail });
});

app.post('/api/vietqr-webhook', async (req, res) => {
    try {
        const { content, transferAmount } = req.body;
        if (content) {
            const match = content.match(/NAP\s+(\d+)/i);
            if (match && users[match[1]]) {
                const chatId = match[1];
                users[chatId].balance += Number(transferAmount || 0);
                saveDatabase();
                
                if (bot) {
                    try {
                        bot.sendMessage(chatId, `🎉 *NẠP TIỀN THÀNH CÔNG!*\n💰 Bạn vừa được cộng +${Number(transferAmount).toLocaleString()} VNĐ.`, { parse_mode: 'Markdown' });
                    } catch (e) {}
                }
                aiEngine.broadcastLog(`[FINANCE] Auto-Deposit: +${transferAmount} VNĐ cho user ${chatId}`);
            }
        }
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ==========================================
// 🤖 KHỞI TẠO BOT TELEGRAM & LOGIC CHÍNH
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
        [{ text: '🎟️ TRUNG TÂM MUA CODE', callback_data: 'buy_code' }],
        [{ text: '💳 NẠP TIỀN', callback_data: 'deposit' }, { text: '📇 TRUNG TÂM KHÁCH HÀNG', callback_data: 'customer_center' }],
        ...(isAdmin ? [[{ text: '🛡️ TRUNG TÂM ADMIN (QUẢN LÝ)', callback_data: 'admin_center' }]] : []),
        [{ text: '👥 NHÓM HỖ TRỢ', url: 'https://t.me/Hendy_Support_Group' }]
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
            users[chatId] = {
                id: chatId,
                name: user.first_name || 'Khách',
                balance: 50000,
                voucher: 0,
                wonCodes: [],
                orders: [],
                linkedAccounts: JSON.parse(JSON.stringify(DEFAULT_LINKED_ACCOUNTS))
            };
        }
        
        if (users[chatId].actionState) delete users[chatId].actionState;
        if (adminSession[chatId]) delete adminSession[chatId];
        saveDatabase();

        sendHomeMenu(chatId, users[chatId], isAdmin);
    });

    bot.on('message', async (msg) => {
        const chatId = msg.chat.id.toString();
        const text = msg.text;
        let u = users[chatId];
        
        if (!u || !text || text.startsWith('/start') || text.startsWith('/done')) return;

        if (text === '/cancel') {
            if (u.actionState) delete u.actionState;
            if (adminSession[chatId]) delete adminSession[chatId];
            saveDatabase();
            bot.sendMessage(chatId, '🚫 Đã hủy thao tác hiện tại.').catch(() => {});
            sendHomeMenu(chatId, u, (chatId === ADMIN_ID));
            return;
        }

        if (chatId === ADMIN_ID && adminSession[chatId]) {
            const session = adminSession[chatId];
            const amount = parseInt(text.replace(/[,.]/g, ''));

            if (isNaN(amount) || amount <= 0) {
                bot.sendMessage(chatId, '❌ Số tiền không hợp lệ. Vui lòng chỉ nhập số (VD: 50000). Gõ /cancel để hủy.').catch(() => {});
                return;
            }

            const targetId = session.targetId;
            const targetUser = users[targetId];

            if (!targetUser) {
                bot.sendMessage(chatId, '❌ Không tìm thấy thông tin khách hàng này.').catch(() => {});
                delete adminSession[chatId];
                return;
            }

            if (session.action === 'ADD') {
                targetUser.balance = (targetUser.balance || 0) + amount;
                saveDatabase();
                bot.sendMessage(chatId, `✅ Đã CỘNG thành công \`${amount.toLocaleString()} VNĐ\` cho khách *${targetUser.name}*.\n💰 Số dư mới: \`${targetUser.balance.toLocaleString()} VNĐ\``, { parse_mode: 'Markdown' }).catch(() => {});
                try {
                    bot.sendMessage(targetId, `💳 *TÀI KHOẢN ĐÃ ĐƯỢC NẠP / CỘNG TIỀN!*\n\n💰 Số tiền: \`+${amount.toLocaleString()} VNĐ\`\n💎 Số dư: \`${targetUser.balance.toLocaleString()} VNĐ\``, { parse_mode: 'Markdown' }).catch(() => {});
                } catch (e) {}
            } else if (session.action === 'SUB') {
                targetUser.balance = Math.max(0, (targetUser.balance || 0) - amount);
                saveDatabase();
                bot.sendMessage(chatId, `✅ Đã TRỪ \`${amount.toLocaleString()} VNĐ\` của khách *${targetUser.name}*.\n💰 Số dư mới: \`${targetUser.balance.toLocaleString()} VNĐ\``, { parse_mode: 'Markdown' }).catch(() => {});
                try {
                    bot.sendMessage(targetId, `⚠️ *THÔNG BÁO TRỪ TIỀN VÍ*\n\n📉 Số tiền: \`-${amount.toLocaleString()} VNĐ\`\n💎 Số dư: \`${targetUser.balance.toLocaleString()} VNĐ\``, { parse_mode: 'Markdown' }).catch(() => {});
                } catch (e) {}
            }

            delete adminSession[chatId];
            return;
        }

        if (u.actionState && u.actionState.step === 'WAITING_LINK') {
            u.actionState.link = text;
            u.actionState.step = 'WAITING_QUANTITY';
            saveDatabase();
            bot.sendMessage(chatId, `🔗 Đã nhận Link mục tiêu.\n\n👉 *Vui lòng nhập số lượng bạn muốn tăng:* (Chỉ nhập số, VD: 1000)\n\n_(Gõ /cancel để hủy)_`, { parse_mode: 'Markdown' }).catch(() => {});
            return;
        }

        if (u.actionState && u.actionState.step === 'WAITING_QUANTITY') {
            const quantity = parseInt(text);
            
            if (isNaN(quantity) || quantity <= 0) {
                bot.sendMessage(chatId, '❌ Số lượng không hợp lệ. Vui lòng chỉ nhập số dương (VD: 1000).').catch(() => {});
                return;
            }

            const totalCost = quantity * u.actionState.price;

            if ((u.balance || 0) < totalCost) {
                bot.sendMessage(chatId, `❌ Tài khoản của bạn không đủ!\n💰 Số dư: \`${(u.balance || 0).toLocaleString()} VNĐ\`\n📉 Yêu cầu: \`${totalCost.toLocaleString()} VNĐ\``, { parse_mode: 'Markdown' }).catch(() => {});
                delete u.actionState; 
                saveDatabase();
                return;
            }

            u.balance -= totalCost;
            const orderDetail = u.actionState;
            const newOrderId = generateOrderId();

            if (!u.orders) u.orders = [];

            const newOrder = {
                id: newOrderId,
                chatId: chatId,
                userId: chatId,
                service: orderDetail.serviceName,
                serviceName: orderDetail.serviceName,
                link: orderDetail.link,
                quantity: quantity,
                totalCost: totalCost,
                status: 'Đang chờ',
                date: new Date().toLocaleString('vi-VN'),
                userName: u.name
            };

            u.orders.push(newOrder);
            orders[newOrderId] = newOrder;
            delete u.actionState; 
            saveDatabase();

            aiEngine.enqueueOrder(newOrder);

            bot.sendMessage(
                chatId, 
                `✅ *TẠO ĐƠN THÀNH CÔNG!* 🚀\n\n` +
                `🏷️ Mã đơn: *${newOrderId}*\n` +
                `📌 Dịch vụ: *${orderDetail.serviceName}*\n` +
                `🔗 Link: ${orderDetail.link}\n` +
                `📊 Số lượng: ${quantity.toLocaleString()}\n` +
                `💸 Tổng tiền: \`-${totalCost.toLocaleString()} VNĐ\`\n` +
                `💰 Số dư còn lại: \`${u.balance.toLocaleString()} VNĐ\`\n\n` +
                `✨ Trạng thái: *🤖 AI Đang tiếp nhận & xử lý tự động...*`,
                { parse_mode: 'Markdown' }
            ).catch(() => {});

            try {
                bot.sendMessage(
                    ADMIN_ID, 
                    `🔔 *ĐƠN SMM MỚI TẠO*\n👤 Khách: ${u.name} (ID: \`${chatId}\`)\n🏷️ Mã Đơn: ${newOrderId}\n📌 Dịch vụ: ${orderDetail.serviceName}\n🔗 Link: ${orderDetail.link}\n📊 SL: ${quantity}\n💵 Tổng thu: ${totalCost.toLocaleString()} VNĐ`, 
                    { parse_mode: 'Markdown' }
                ).catch(() => {});
            } catch (e) {}
        }
    });

    bot.on('callback_query', (query) => {
        const chatId = query.from.id.toString();
        const data = query.data;
        const u = users[chatId];
        if (!u) return;

        if (data === 'smm_main') {
            let text = `🌐 *DANH MỤC DỊCH VỤ MXH*\nVui lòng chọn nền tảng bạn muốn sử dụng:\n--------------------------------------------------\n`;
            let kb = [];
            Object.keys(SMM_SERVICES).forEach(key => {
                kb.push([{ text: SMM_SERVICES[key].title, callback_data: `smm_cat_${key}` }]);
            });
            kb.push([{ text: '◀ Quay lại Trang chủ', callback_data: 'back_start' }]);
            bot.editMessageText(text, { chat_id: chatId, message_id: query.message.message_id, parse_mode: 'Markdown', reply_markup: { inline_keyboard: kb } }).catch(() => {});
        }
        else if (data.startsWith('smm_cat_')) {
            const catKey = data.replace('smm_cat_', '');
            const category = SMM_SERVICES[catKey];
            if (category) {
                let text = `${category.title}\n--------------------------------------------------\n`;
                let kb = [];
                category.items.forEach((item, idx) => {
                    text += `• *${item.name}*: \`${item.price.toLocaleString()} VNĐ/lượt\`\n`;
                    kb.push([{ text: `🛒 Đặt hàng: ${item.name}`, callback_data: `order_${catKey}_${idx}` }]);
                });
                kb.push([{ text: '◀ Quay lại Danh mục', callback_data: 'smm_main' }]);
                bot.editMessageText(text, { chat_id: chatId, message_id: query.message.message_id, parse_mode: 'Markdown', reply_markup: { inline_keyboard: kb } }).catch(() => {});
            }
        }
        else if (data.startsWith('order_')) {
            const parts = data.split('_');
            const catKey = parts[1];
            const itemIdx = parseInt(parts[2]);
            const item = SMM_SERVICES[catKey]?.items[itemIdx];

            if (item) {
                u.actionState = {
                    step: 'WAITING_LINK',
                    serviceName: item.name,
                    price: item.price
                };
                saveDatabase();
                bot.sendMessage(chatId, `📌 Bạn đang đặt: *${item.name}*\n💰 Đơn giá: \`${item.price.toLocaleString()} VNĐ / 1 lượt\`\n\n👉 *Vui lòng dán Link / ID mục tiêu vào đây:*\n\n_(Gõ /cancel nếu bạn muốn hủy)_`, { parse_mode: 'Markdown' }).catch(() => {});
            }
        }
        else if (data === 'deposit') {
            const depositMsg = `💳 *CỔNG NẠP TIỀN TỰ ĐỘNG (VIETQR)*\n--------------------------------------------------\n` +
            `🏛 Ngân hàng: *${BANK_CONFIG.bankId}*\n` +
            `🔢 Số tài khoản: \`${BANK_CONFIG.accountNo}\`\n` +
            `👤 Chủ tài khoản: *${BANK_CONFIG.accountName}*\n` +
            `📝 Nội dung chuyển khoản: \`NAP ${chatId}\`\n--------------------------------------------------\n` +
            `⚠️ *Lưu ý:* Vui lòng ghi đúng nội dung để hệ thống cộng tiền tự động trong 3 giây.`;
            
            let kb = [[{ text: '◀ Quay lại Trang chủ', callback_data: 'back_start' }]];
            bot.editMessageText(depositMsg, { chat_id: chatId, message_id: query.message.message_id, parse_mode: 'Markdown', reply_markup: { inline_keyboard: kb } }).catch(() => {});
        }
        else if (data === 'customer_center') {
            if (!u.orders) u.orders = [];
            
            let text = `📇 *TRUNG TÂM KHÁCH HÀNG*\n👤 Xin chào sếp: *${u.name}*\n💰 Số dư ví: \`${(u.balance || 0).toLocaleString()} VNĐ\`\n--------------------------------------------------\n`;
            text += `📦 *DANH SÁCH ĐƠN HÀNG:*\n\n`;

            const userOrders = u.orders.slice().reverse().slice(0, 15);

            if (userOrders.length === 0) {
                text += `_Hiện tại bạn chưa có đơn hàng nào._\n`;
            } else {
                userOrders.forEach((o) => {
                    text += `🏷️ *Mã đơn:* \`${o.id}\`\n`;
                    text += `📌 *Dịch vụ:* ${o.serviceName || o.service}\n`;
                    text += `🔗 *Link:* ${o.link}\n`;
                    text += `📊 *SL:* ${(o.quantity || 0).toLocaleString()} | 💸 \`${(o.totalCost || 0).toLocaleString()} VNĐ\`\n`;
                    text += `⏰ *Lúc:* ${o.date || 'N/A'}\n`;
                    text += `🔄 *Trạng thái:* ${o.status}\n`;
                    text += `—\n`;
                });
            }

            let kb = [[{ text: '◀ Quay lại Trang chủ', callback_data: 'back_start' }]];
            bot.editMessageText(text, { chat_id: chatId, message_id: query.message.message_id, parse_mode: 'Markdown', reply_markup: { inline_keyboard: kb } }).catch(() => {});
        }
        else if (data === 'admin_center') {
            if (chatId !== ADMIN_ID) {
                bot.answerCallbackQuery(query.id, { text: '❌ Bạn không có quyền truy cập!', show_alert: true }).catch(() => {});
                return;
            }

            const totalUsers = Object.keys(users).length;
            let totalBalance = 0;
            let totalOrders = Object.keys(orders).length;
            Object.values(users).forEach(usr => {
                totalBalance += (usr.balance || 0);
            });

            let text = `🛡️ *TRUNG TÂM QUẢN LÝ ADMIN*\n--------------------------------------------------\n`;
            text += `👥 Tổng khách hàng: \`${totalUsers}\`\n`;
            text += `💰 Tổng số dư ví: \`${totalBalance.toLocaleString()} VNĐ\`\n`;
            text += `📦 Tổng số đơn: \`${totalOrders}\`\n--------------------------------------------------\n`;
            text += `👉 *Chọn khách hàng bên dưới để quản lý số dư:*`;

            let kb = [];
            const recentUserIds = Object.keys(users).slice(-10).reverse();
            recentUserIds.forEach(uid => {
                const usr = users[uid];
                kb.push([{ text: `👤 ${usr.name} | 💰 ${(usr.balance || 0).toLocaleString()}đ`, callback_data: `admin_user_${uid}` }]);
            });

            kb.push([{ text: '🔄 Làm mới', callback_data: 'admin_center' }, { text: '◀ Quay lại Trang chủ', callback_data: 'back_start' }]);
            bot.editMessageText(text, { chat_id: chatId, message_id: query.message.message_id, parse_mode: 'Markdown', reply_markup: { inline_keyboard: kb } }).catch(() => {});
        }
        else if (data.startsWith('admin_user_')) {
            if (chatId !== ADMIN_ID) return;
            const targetId = data.replace('admin_user_', '');
            const targetUser = users[targetId];

            if (!targetUser) {
                bot.answerCallbackQuery(query.id, { text: '❌ Khách hàng không tồn tại!', show_alert: true }).catch(() => {});
                return;
            }

            let text = `👤 *QUẢN LÝ KHÁCH HÀNG*\n--------------------------------------------------\n`;
            text += `📌 Tên: *${targetUser.name}*\n`;
            text += `🆔 ID Telegram: \`${targetId}\`\n`;
            text += `💰 Số dư ví: \`${(targetUser.balance || 0).toLocaleString()} VNĐ\`\n`;
            text += `📦 Tổng đơn: \`${targetUser.orders ? targetUser.orders.length : 0}\`\n--------------------------------------------------\n`;

            let kb = [
                [{ text: '➕ Cộng / Nạp tiền', callback_data: `admin_add_${targetId}` }, { text: '➖ Trừ tiền', callback_data: `admin_sub_${targetId}` }],
                [{ text: '◀ Quay lại danh sách Admin', callback_data: 'admin_center' }]
            ];
            bot.editMessageText(text, { chat_id: chatId, message_id: query.message.message_id, parse_mode: 'Markdown', reply_markup: { inline_keyboard: kb } }).catch(() => {});
        }
        else if (data.startsWith('admin_add_')) {
            if (chatId !== ADMIN_ID) return;
            const targetId = data.replace('admin_add_', '');
            const targetUser = users[targetId];
            adminSession[chatId] = { action: 'ADD', targetId: targetId };
            bot.sendMessage(chatId, `➕ *CỘNG TIỀN CHO KHÁCH*\n👤 Khách: *${targetUser?.name || targetId}*\n\n👉 *Nhập số tiền muốn cộng:* (VD: 50000)\n_(Gõ /cancel để hủy)_`, { parse_mode: 'Markdown' }).catch(() => {});
        }
        else if (data.startsWith('admin_sub_')) {
            if (chatId !== ADMIN_ID) return;
            const targetId = data.replace('admin_sub_', '');
            const targetUser = users[targetId];
            adminSession[chatId] = { action: 'SUB', targetId: targetId };
            bot.sendMessage(chatId, `➖ *TRỪ TIỀN KHÁCH HÀNG*\n👤 Khách: *${targetUser?.name || targetId}*\n\n👉 *Nhập số tiền muốn trừ:* (VD: 20000)\n_(Gõ /cancel để hủy)_`, { parse_mode: 'Markdown' }).catch(() => {});
        }
        else if (data === 'buy_code') {
            let textMenu = `🎟️ *TRUNG TÂM MUA CODE & NHÀ CÁI*\n☕ Chào sếp *${u.name}*\n--------------------------------------------------\n`;
            let kb = [];
            Object.keys(u.linkedAccounts || DEFAULT_LINKED_ACCOUNTS).forEach(brand => {
                let count = u.linkedAccounts[brand] ? u.linkedAccounts[brand].length : 0;
                textMenu += `• ${brand}: [ ${count} ]\n`;
                kb.push([{ text: `▶ ${brand} (${count})`, callback_data: `page_${brand}` }]);
            });
            kb.push([{ text: '◀ Quay lại', callback_data: 'back_start' }]);
            bot.editMessageText(textMenu, { chat_id: chatId, message_id: query.message.message_id, parse_mode: 'Markdown', reply_markup: { inline_keyboard: kb } }).catch(() => {});
        }
        else if (data === 'back_start') {
            if (u.actionState) delete u.actionState;
            if (adminSession[chatId]) delete adminSession[chatId];
            saveDatabase();
            sendHomeMenu(chatId, u, (chatId === ADMIN_ID));
        }

        bot.answerCallbackQuery(query.id).catch(() => {});
    });
}

function startBot(token) {
    if (!token) {
        console.warn('⚠️ BOT_TOKEN trống, bỏ qua khởi động Telegram Bot.');
        return false;
    }
    if (bot) {
        try { bot.stopPolling(); } catch (e) {}
        bot = null;
    }
    try {
        bot = new TelegramBot(token, { polling: true });
        bot.on('polling_error', (error) => {
            console.error(`[BOT ERROR] Polling error: ${error.code} - ${error.message}`);
        });
        setupBotLogic();
        console.log('🤖 Bot Telegram đã khởi động thành công!');
        return true;
    } catch (e) {
        console.error("❌ Lỗi khởi động bot:", e.message);
        return false;
    }
}

// ==========================================
// 🔌 WEBSOCKET SERVER REALTIME CONNECTION (CLOUD BRAIN)
// ==========================================
wss.on('connection', (ws, req) => {
    ws.id = "TAB_" + Math.random().toString(36).substr(2, 9);
    ws.isAlive = true;
    console.log(`[+] Đàn em gia nhập hệ thống: ${ws.id}`);

    let totalUsers = Object.keys(users).length;
    let totalBalance = 0;
    Object.values(users).forEach(u => { totalBalance += (u.balance || 0); });

    // Gửi dữ liệu khởi tạo Dashboard
    ws.send(JSON.stringify({
        type: 'INIT_DATA',
        totalUsers: totalUsers,
        totalBalance: totalBalance,
        orders: Object.values(orders).reverse(),
        brandStatuses: brandStatuses
    }));

    aiEngine.broadcastSessionState();
    aiEngine.broadcastLog('[SYSTEM] Đã kết nối với Master Control Panel thành công.');

    ws.on('pong', () => { ws.isAlive = true; });

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            
            // 0. Xác thực Secret Token nếu client gửi kèm
            if (data.token && data.token !== SYSTEM_SECRET_TOKEN) {
                ws.send(JSON.stringify({ action: 'ERROR', message: 'Sai Secret Token bảo mật!' }));
                return;
            }

            // 1. Phản hồi lệnh PING từ client để đo độ trễ (Latency)
            if (data.action === 'PING' || data.type === 'PING') {
                ws.send(JSON.stringify({ type: 'PONG', timestamp: data.timestamp || data.time }));
                return;
            }

            // 2. Nếu Đàn Em khai báo danh tính -> Lưu vào Não Bộ
            if (data.action === 'TAB_HEARTBEAT') {
                CloudState.tabs[ws.id] = data.info;
                return;
            }

            // 3. Nếu Trạm Mẹ gửi danh sách Tài khoản -> Server làm "Nhà Cái" lưu trữ
            if (data.action === 'UPDATE_ACCOUNTS_POOL') {
                CloudState.accounts = data.pool;
                console.log(`[💾 CLOUD SAVED] Đã nhận ${Object.keys(CloudState.accounts).length} tài khoản từ Trạm Mẹ.`);
                distributeAccounts();
                return;
            }

            // 4. BROADCAST: Phóng lệnh đi tốc độ ánh sáng cho các Tab khác
            wss.clients.forEach((client) => {
                if (client !== ws && client.readyState === WebSocket.OPEN) {
                    client.send(JSON.stringify(data));
                }
            });
        } catch (err) {
            console.error('[!] Lỗi băng thông:', err.message);
        }
    });

    ws.on('close', () => {
        console.log(`[-] Đàn em ngắt mạng: ${ws.id}`);
        delete CloudState.tabs[ws.id];
    });
});

// ==========================================
// 🌟 VÒNG LẶP SINH TỬ TỐI ƯU CỰC MƯỢT (15s/lần)
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
    console.log(`========================================`);
    console.log(`👑 MASTER CONTROL PANEL V6100 CHẠY CỔNG ${PORT}`);
    console.log(`========================================`);
});
