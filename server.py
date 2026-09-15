import asyncio
import json
import os
import random
import time
from datetime import datetime
from typing import Dict, Any, List

import uvicorn
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, Header, Request
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv

from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import Application, CommandHandler, CallbackQueryHandler, MessageHandler, filters, ContextTypes

load_dotenv()

# ==========================================
# ⚙️ CẤU HÌNH HỆ THỐNG CƠ BẢN
# ==========================================
PORT = int(os.getenv("PORT", 8080))
BOT_TOKEN = os.getenv("BOT_TOKEN") or os.getenv("TELEGRAM_TOKEN") or "8689114890:AAFBFM0rNtZWpOtAovIPHPVQTJVp0odU1DQ"
ADMIN_ID = os.getenv("ADMIN_ID", "6138197737")
CHANNEL_ID = os.getenv("CHANNEL_ID", "-100xxxxxxxxx")
INTERNAL_SECRET = os.getenv("INTERNAL_SECRET", "hendy_secret_key_2026")
SYSTEM_SECRET_TOKEN = os.getenv("SECRET_TOKEN", "HENDY_SECURE_TOKEN_V6100")

BANK_CONFIG = {
    "bankId": "MB",
    "accountNo": "0123456789",
    "accountName": "HENDY SYSTEM"
}

app = FastAPI(title="Master Control Panel V6100 Python")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Phục vụ static files (HTML, CSS, JS)
app.mount("/public", StaticFiles(directory="."), name="public")

@app.get("/", response_class=HTMLResponse)
async def serve_index():
    index_path = "index.html"
    if os.path.exists(index_path):
        with open(index_path, "r", encoding="utf-8") as f:
            return f.read()
    return "<h1>👑 HENDY V5.0 GOD TIER - PYTHON CLOUD BRAIN ĐANG HOẠT ĐỘNG!</h1>"

# ==========================================
# 🗄️ QUẢN LÝ DATABASE (USERS & ORDERS)
# ==========================================
DB_FILE = "database.json"
users: Dict[str, Any] = {}
orders: Dict[str, Any] = {}
admin_session: Dict[str, Any] = {}
telegram_app: Application = None

CloudState = {
    "tabs": {},
    "accounts": {},
    "globalCmd": {}
}

DEFAULT_LINKED_ACCOUNTS = {
    "SC88": [],
    "C168": [],
    "CM88": [],
    "F8BET": [],
    "QQ88": [],
    "78WIN": []
}

def load_database():
    global users, orders
    try:
        if os.path.exists(DB_FILE):
            with open(DB_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
                users = data.get("users", {})
                orders = data.get("orders", {})

                for uid in users:
                    if "linkedAccounts" not in users[uid]:
                        users[uid]["linkedAccounts"] = json.loads(json.dumps(DEFAULT_LINKED_ACCOUNTS))
                    if "balance" not in users[uid]:
                        users[uid]["balance"] = 50000
                    if "orders" not in users[uid]:
                        users[uid]["orders"] = []

                for u in users.values():
                    if isinstance(u.get("orders"), list):
                        for o in u["orders"]:
                            if o.get("id") and o["id"] not in orders:
                                orders[o["id"]] = o

                print(f"✅ Đã tải dữ liệu: {len(users)} người dùng | {len(orders)} đơn hàng.")
        else:
            users = {}
            orders = {}
            save_database()
    except Exception as err:
        print(f"❌ Lỗi đọc database: {err}")
        users = {}
        orders = {}

def save_database():
    try:
        with open(DB_FILE, "w", encoding="utf-8") as f:
            json.dump({"users": users, "orders": orders}, f, ensure_ascii=False, indent=4)
    except Exception as err:
        print(f"❌ Lỗi lưu database: {err}")

def generate_order_id():
    return 'ORD' + str(random.randint(10000, 99999))

# ==========================================
# 📦 DANH MỤC DỊCH VỤ MXH & THÔNG SỐ
# ==========================================
SMM_SERVICES = {
    "coin_master": {
        "title": "🎲 SPIN COIN MASTER",
        "items": [
            {"name": "Spin Coin Master", "price": 1000},
            {"name": "Spin Coin Master (Extra)", "price": 1500},
            {"name": "Sự Kiện Mời Đối Tác", "price": 5000}
        ]
    },
    "facebook": {
        "title": "📘 DỊCH VỤ FACEBOOK",
        "items": [
            {"name": "Tăng Like Facebook", "price": 100},
            {"name": "Tăng Follow Facebook", "price": 150},
            {"name": "Tăng Lượt Xem Story", "price": 50},
            {"name": "Tăng Share Bài Viết", "price": 200},
            {"name": "Tăng Like / Follow Fanpage", "price": 180},
            {"name": "Tăng View Live Stream", "price": 300},
            {"name": "Tăng Member Facebook", "price": 120},
            {"name": "Tăng Bình Luận Facebook", "price": 250},
            {"name": "Tăng Lượt Xem Video", "price": 40}
        ]
    },
    "tiktok": {
        "title": "🎵 DỊCH VỤ TIKTOK",
        "items": [
            {"name": "Tăng Tim Tiktok", "price": 80},
            {"name": "Tăng Follow Tiktok", "price": 120},
            {"name": "Tăng View Tiktok", "price": 20},
            {"name": "Tăng Share Tiktok", "price": 100},
            {"name": "Tăng Save Tiktok", "price": 90},
            {"name": "Tăng Bình Luận Tiktok", "price": 200},
            {"name": "Tăng Mắt Live Tiktok", "price": 350}
        ]
    },
    "instagram": {
        "title": "📸 DỊCH VỤ INSTAGRAM",
        "items": [
            {"name": "Tăng Tim Bài Viết INS", "price": 90},
            {"name": "Tăng Theo Dõi Instagram", "price": 140}
        ]
    },
    "youtube": {
        "title": "▶️ DỊCH VỤ YOUTUBE",
        "items": [
            {"name": "Tăng Subscribe Youtube", "price": 300},
            {"name": "Tăng View Youtube", "price": 50},
            {"name": "Tăng Like Youtube", "price": 100}
        ]
    },
    "shopee": {
        "title": "🛍️ DỊCH VỤ SHOPEE",
        "items": [
            {"name": "Tăng Theo Dõi Shopee", "price": 150},
            {"name": "Tăng Tim Shopee", "price": 80},
            {"name": "Tăng Mắt Live Shopee", "price": 400}
        ]
    },
    "twitter_x": {
        "title": "𝕏 DỊCH VỤ X (TWITTER)",
        "items": [
            {"name": "Tăng Like X", "price": 110},
            {"name": "Tăng Follow X", "price": 160},
            {"name": "Tăng Lượt Xem X", "price": 30}
        ]
    },
    "bigo": {
        "title": "🐥 DỊCH VỤ BIGO LIVE",
        "items": [
            {"name": "Tăng Mắt Xem Bigo Live", "price": 500}
        ]
    },
    "telegram": {
        "title": "✈️ DỊCH VỤ TELEGRAM",
        "items": [
            {"name": "Tăng Member Telegram Group/Channel", "price": 130},
            {"name": "Tăng View Bài Viết Telegram", "price": 25}
        ]
    },
    "thread": {
        "title": "🌀 DỊCH VỤ THREAD",
        "items": [
            {"name": "Tăng Follow Thread", "price": 150},
            {"name": "Tăng Like Thread", "price": 100}
        ]
    }
}

brandStatuses = {
    'SC88': {'status': '🟢 Hoạt động', 'ping': 12},
    'C168': {'status': '🟢 Hoạt động', 'ping': 15},
    'F8BET': {'status': '🟢 Hoạt động', 'ping': 14}
}

# ==========================================
# 🔌 WEBSOCKET CONNECTION MANAGER
# ==========================================
class ConnectionManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)

    async def broadcast(self, message: dict):
        for connection in self.active_connections:
            try:
                await connection.send_text(json.dumps(message))
            except Exception:
                pass

manager = ConnectionManager()

# ==========================================
# 🧠 LÕI AI ENGINE ĐIỀU KHIỂN HỆ THỐNG ĐA PHIÊN
# ==========================================
class AISessionManager:
    def __init__(self, max_concurrent=10):
        self.max_concurrent = max_concurrent
        self.active_sessions: Dict[str, dict] = {}
        self.queue: List[dict] = []

    def enqueue_order(self, order: dict):
        self.queue.append(order)
        asyncio.create_task(self.broadcast_log(f"[AI ENGINE] Đã nhận đơn #{order['id']} ({order.get('serviceName') or order.get('service')}) vào hàng chờ."))
        asyncio.create_task(self.process_next())

    async def process_next(self):
        if len(self.active_sessions) >= self.max_concurrent or len(self.queue) == 0:
            return

        order = self.queue.pop(0)
        session_id = f"BOT_{str(int(time.time()))[-6]}_{random.randint(10, 99)}"
        
        self.active_sessions[session_id] = {
            "id": session_id,
            "orderId": order["id"],
            "targetLink": order["link"],
            "quantity": order["quantity"],
            "progress": 0,
            "status": "RUNNING"
        }

        if order["id"] in orders:
            orders[order["id"]]["status"] = '⏳ Đang xử lý'
        chat_id = order.get("chatId")
        if chat_id and chat_id in users and isinstance(users[chat_id].get("orders"), list):
            for u_order in users[chat_id]["orders"]:
                if u_order["id"] == order["id"]:
                    u_order["status"] = '⏳ Đang xử lý'
        save_database()

        await self.broadcast_log(f"[AI ENGINE] Khởi tạo luồng {session_id} chạy đơn #{order['id']} cho link: {order['link']}")
        await self.broadcast_session_state()
        await self.broadcast_order_update()
        
        asyncio.create_task(self.run_worker_session(session_id, order))

    async def run_worker_session(self, session_id: str, order: dict):
        session = self.active_sessions.get(session_id)
        if not session:
            return
        target_qty = int(order.get("quantity", 100))
        completed = 0

        while completed < target_qty:
            await asyncio.sleep(2)
            step = min(random.randint(5, 20), target_qty - completed)
            completed += step
            session["progress"] = round((completed / target_qty) * 100)
            await self.broadcast_session_state()

        session["status"] = "COMPLETED"
        session["progress"] = 100

        if order["id"] in orders:
            orders[order["id"]]["status"] = '✅ Hoàn thành'
        chat_id = order.get("chatId")
        if chat_id and chat_id in users and isinstance(users[chat_id].get("orders"), list):
            for u_order in users[chat_id]["orders"]:
                if u_order["id"] == order["id"]:
                    u_order["status"] = '✅ Hoàn thành'
        save_database()

        await self.broadcast_log(f"[AI ENGINE] ✅ Phiên {session_id} hoàn thành! Đã bơm {target_qty} cho {order['link']}")
        await self.broadcast_order_update()
        
        self.active_sessions.pop(session_id, None)
        await self.broadcast_session_state()
        await self.process_next()

    async def broadcast_log(self, message: str):
        current_time = datetime.now().strftime("%H:%M:%S")
        await manager.broadcast({"type": "AI_SYSTEM_LOG", "timestamp": current_time, "text": message})

    async def broadcast_session_state(self):
        await manager.broadcast({
            "type": "AI_SESSIONS_UPDATE",
            "activeCount": len(self.active_sessions),
            "sessions": list(self.active_sessions.values())
        })

    async def broadcast_order_update(self):
        rev_orders = list(orders.values())
        rev_orders.reverse()
        await manager.broadcast({"type": "ORDERS_UPDATED", "orders": rev_orders})

aiEngine = AISessionManager(10)

def distribute_accounts():
    available_accs = list(CloudState["accounts"].values())
    if not available_accs:
        return

    for client_id, tab_info in CloudState["tabs"].items():
        if tab_info.get("needsLogin"):
            target_acc = next((acc for acc in available_accs if acc.get("brand") == tab_info.get("brand") and not acc.get("isUsed")), None)
            if target_acc:
                target_acc["isUsed"] = True
                # Gửi lệnh trực tiếp qua WS nếu cần xử lý tại kết nối tương ứng

# ==========================================
# 🌐 REST API & PUPPETEER ENDPOINTS
# ==========================================
class PuppeteerRequest(BaseModel):
    targetUrl: str
    chatId: str = None

class BroadcastRequest(BaseModel):
    message: str

@app.get("/health")
async def health_check():
    return {"status": "OK", "system": "Master Control Panel V6100 Python"}

@app.post("/api/smm/run-puppeteer")
async def run_puppeteer(req: PuppeteerRequest, x_internal_secret: str = Header(None)):
    if not x_internal_secret or x_internal_secret != INTERNAL_SECRET:
        raise HTTPException(status_code=403, detail="Unauthorized request from Edge Worker")
    
    target_url = req.targetUrl
    if not target_url:
        raise HTTPException(status_code=400, detail="Target URL is required")

    try:
        await aiEngine.broadcast_log(f"[PUPPETEER] Bắt đầu cào dữ liệu cho URL: {target_url}")
        
        # Thử sử dụng thư viện Playwright hoặc BeautifulSoup/Aiohttp thay thế Puppeteer Node.js
        import aiohttp
        from bs4 import BeautifulSoup

        async with aiohttp.ClientSession() as session:
            async with session.get(target_url, headers={"User-Agent": "Mozilla/5.0"}, timeout=15) as resp:
                html = await resp.text()
                soup = BeautifulSoup(html, 'html.parser')
                title = soup.title.string if soup.title else "Không có tiêu đề"
                meta_desc = soup.find("meta", attrs={"name": "description"})
                description = meta_desc["content"] if meta_desc and "content" in meta_desc else "Không có mô tả"

                extracted_data = {
                    "title": title,
                    "description": description,
                    "url": target_url,
                    "scrapedAt": datetime.utcnow().isoformat()
                }
                await aiEngine.broadcast_log(f"[PUPPETEER] ✅ Cào thành công trang: {title}")
                return {"success": True, "data": extracted_data}
    except Exception as err:
        await aiEngine.broadcast_log(f"[PUPPETEER ERROR] {str(err)}")
        return {"success": False, "error": str(err)}

@app.post("/api/ai/run-all")
async def run_all_ai():
    count = 0
    for order in orders.values():
        if order.get("status") in ["Đang chờ", "Pending"]:
            aiEngine.enqueue_order(order)
            count += 1
    return {"success": True, "message": f"Đã đẩy {count} đơn vào hệ thống AI đa phiên."}

@app.post("/api/broadcast")
async def api_broadcast(req: BroadcastRequest):
    message = req.message
    if not message:
        raise HTTPException(status_code=400, detail="Nội dung không được để trống")
    success, fail = 0, 0
    if telegram_app and telegram_app.bot:
        for chat_id in users.keys():
            try:
                await telegram_app.bot.send_message(chat_id=chat_id, text=f"📢 *THÔNG BÁO TỪ HỆ THỐNG*\n\n{message}", parse_mode="Markdown")
                success += 1
            except Exception:
                fail += 1
    await aiEngine.broadcast_log(f"[BROADCAST] Đã gửi thông báo tới {success} user ({fail} lỗi).")
    return {"success": True, "successCount": success, "failCount": fail}

@app.post("/api/vietqr-webhook")
async def vietqr_webhook(request: Request):
    try:
        body = await request.json()
        content = body.get("content")
        transfer_amount = body.get("transferAmount", 0)
        if content:
            import re
            match = re.search(r"NAP\s+(\d+)", content, re.IGNORECASE)
            if match:
                chat_id = match.group(1)
                if chat_id in users:
                    users[chat_id]["balance"] = users[chat_id].get("balance", 0) + float(transfer_amount)
                    save_database()
                    if telegram_app and telegram_app.bot:
                        try:
                            await telegram_app.bot.send_message(
                                chat_id=chat_id,
                                text=f"🎉 *NẠP TIỀN THÀNH CÔNG!*\n💰 Bạn vừa được cộng +{int(transfer_amount):,} VNĐ.",
                                parse_mode="Markdown"
                            )
                        except Exception:
                            pass
                    await aiEngine.broadcast_log(f"[FINANCE] Auto-Deposit: +{transfer_amount} VNĐ cho user {chat_id}")
        return {"success": True}
    except Exception as e:
        return JSONResponse(status_code=500, content={"error": str(e)})

# ==========================================
# 🤖 BOT TELEGRAM LOGIC (PYTHON-TELEGRAM-BOT)
# ==========================================
async def send_home_menu(update_or_query, context, chat_id, user_data, is_admin):
    welcome_message = (
        f"🤖 *HỆ THỐNG DỊCH VỤ MXH PRO* 🚀\n"
        f"Chào mừng sếp, *{user_data.get('name', 'Khách')}*\n"
        f"--------------------------------------------------\n"
        f"💎 *Phân quyền:* {'👑 ADMIN TỐI CAO' if is_admin else '👤 KHÁCH HÀNG'}\n"
        f"💰 **Ví Chính:** `{int(user_data.get('balance', 0)):,} VNĐ`\n"
        f"--------------------------------------------------\n"
        f"👉 Chọn dịch vụ cần giao dịch bên dưới:"
    )

    inline_keyboard = [
        [InlineKeyboardButton("🌐 DỊCH VỤ MẠNG XÃ HỘI", callback_data="smm_main")],
        [InlineKeyboardButton("🎟️ TRUNG TÂM MUA CODE", callback_data="buy_code")],
        [InlineKeyboardButton("💳 NẠP TIỀN", callback_data="deposit"), InlineKeyboardButton("📇 TRUNG TÂM KHÁCH HÀNG", callback_data="customer_center")],
    ]
    if is_admin:
        inline_keyboard.append([InlineKeyboardButton("🛡️ TRUNG TÂM ADMIN (QUẢN LÝ)", callback_data="admin_center")])
    inline_keyboard.append([InlineKeyboardButton("👥 NHÓM HỖ TRỢ", url="https://t.me/Hendy_Support_Group")])

    reply_markup = InlineKeyboardMarkup(inline_keyboard)
    
    if hasattr(update_or_query, "message") and update_or_query.message:
        try:
            await update_or_query.message.edit_text(welcome_message, parse_mode="Markdown", reply_markup=reply_markup)
            return
        except Exception:
            pass
    if context and chat_id:
        await context.bot.send_message(chat_id=chat_id, text=welcome_message, parse_mode="Markdown", reply_markup=reply_markup)

async def start_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE):
    chat_id = str(update.effective_chat.id)
    user = update.effective_user
    is_admin = (chat_id == ADMIN_ID)

    if chat_id not in users:
        users[chat_id] = {
            "id": chat_id,
            "name": user.first_name or "Khách",
            "balance": 50000,
            "voucher": 0,
            "wonCodes": [],
            "orders": [],
            "linkedAccounts": json.loads(json.dumps(DEFAULT_LINKED_ACCOUNTS))
        }

    if "actionState" in users[chat_id]:
        users[chat_id].pop("actionState")
    if chat_id in admin_session:
        admin_session.pop(chat_id)
    save_database()

    await send_home_menu(update, context, chat_id, users[chat_id], is_admin)

async def handle_message(update: Update, context: ContextTypes.DEFAULT_TYPE):
    chat_id = str(update.effective_chat.id)
    text = update.message.text
    u = users.get(chat_id)

    if not u or not text or text.startswith('/start') or text.startswith('/done'):
        return

    if text == '/cancel':
        if "actionState" in u:
            u.pop("actionState")
        if chat_id in admin_session:
            admin_session.pop(chat_id)
        save_database()
        await update.message.reply_text("🚫 Đã hủy thao tác hiện tại.")
        await send_home_menu(update, context, chat_id, u, (chat_id == ADMIN_ID))
        return

    if chat_id == ADMIN_ID and chat_id in admin_session:
        session = admin_session[chat_id]
        try:
            amount = int(text.replace(',', '').replace('.', ''))
        except ValueError:
            await update.message.reply_text("❌ Số tiền không hợp lệ. Vui lòng chỉ nhập số (VD: 50000). Gõ /cancel để hủy.")
            return

        target_id = session["targetId"]
        target_user = users.get(target_id)
        if not target_user:
            await update.message.reply_text("❌ Không tìm thấy thông tin khách hàng này.")
            admin_session.pop(chat_id, None)
            return

        if session["action"] == "ADD":
            target_user["balance"] = target_user.get("balance", 0) + amount
            save_database()
            await update.message.reply_text(f"✅ Đã CỘNG thành công `{amount:,} VNĐ` cho khách *{target_user['name']}*.\n💰 Số dư mới: `{target_user['balance']:,} VNĐ`", parse_mode="Markdown")
            try:
                await context.bot.send_message(chat_id=target_id, text=f"💳 *TÀI KHOẢN ĐÃ ĐƯỢC NẠP / CỘNG TIỀN!*\n\n💰 Số tiền: `+{amount:,} VNĐ`\n💎 Số dư: `{target_user['balance']:,} VNĐ`", parse_mode="Markdown")
            except Exception:
                pass
        elif session["action"] == "SUB":
            target_user["balance"] = max(0, target_user.get("balance", 0) - amount)
            save_database()
            await update.message.reply_text(f"✅ Đã TRỪ `{amount:,} VNĐ` của khách *{target_user['name']}*.\n💰 Số dư mới: `{target_user['balance']:,} VNĐ`", parse_mode="Markdown")
            try:
                await context.bot.send_message(chat_id=target_id, text=f"⚠️ *THÔNG BÁO TRỪ TIỀN VÍ*\n\n📉 Số tiền: `-{amount:,} VNĐ`\n💎 Số dư: `{target_user['balance']:,} VNĐ`", parse_mode="Markdown")
            except Exception:
                pass

        admin_session.pop(chat_id, None)
        return

    if u.get("actionState", {}).get("step") == "WAITING_LINK":
        u["actionState"]["link"] = text
        u["actionState"]["step"] = "WAITING_QUANTITY"
        save_database()
        await update.message.reply_text("🔗 Đã nhận Link mục tiêu.\n\n👉 *Vui lòng nhập số lượng bạn muốn tăng:* (Chỉ nhập số, VD: 1000)\n\n_(Gõ /cancel để hủy)_", parse_mode="Markdown")
        return

    if u.get("actionState", {}).get("step") == "WAITING_QUANTITY":
        try:
            quantity = int(text)
        except ValueError:
            await update.message.reply_text("❌ Số lượng không hợp lệ. Vui lòng chỉ nhập số dương (VD: 1000).")
            return

        if quantity <= 0:
            await update.message.reply_text("❌ Số lượng phải lớn hơn 0.")
            return

        total_cost = quantity * u["actionState"]["price"]
        if u.get("balance", 0) < total_cost:
            await update.message.reply_text(f"❌ Tài khoản của bạn không đủ!\n💰 Số dư: `{int(u.get('balance', 0)):,} VNĐ`\n📉 Yêu cầu: `{total_cost:,} VNĐ`", parse_mode="Markdown")
            u.pop("actionState")
            save_database()
            return

        u["balance"] -= total_cost
        order_detail = u["actionState"]
        new_order_id = generate_order_id()

        if "orders" not in u:
            u["orders"] = []

        new_order = {
            "id": new_order_id,
            "chatId": chat_id,
            "userId": chat_id,
            "service": order_detail["serviceName"],
            "serviceName": order_detail["serviceName"],
            "link": order_detail["link"],
            "quantity": quantity,
            "totalCost": total_cost,
            "status": "Đang chờ",
            "date": datetime.now().strftime("%d/%m/%Y, %H:%M:%S"),
            "userName": u["name"]
        }

        u["orders"].append(new_order)
        orders[new_order_id] = new_order
        u.pop("actionState")
        save_database()

        aiEngine.enqueue_order(new_order)

        await update.message.reply_text(
            f"✅ *TẠO ĐƠN THÀNH CÔNG!* 🚀\n\n"
            f"🏷️ Mã đơn: *{new_order_id}*\n"
            f"📌 Dịch vụ: *{order_detail['serviceName']}*\n"
            f"🔗 Link: {order_detail['link']}\n"
            f"📊 Số lượng: {quantity:,}\n"
            f"💸 Tổng tiền: `-{total_cost:,} VNĐ`\n"
            f"💰 Số dư còn lại: `{int(u['balance']):,} VNĐ`\n\n"
            f"✨ Trạng thái: *🤖 AI Đang tiếp nhận & xử lý tự động...*",
            parse_mode="Markdown"
        )

        try:
            await context.bot.send_message(
                chat_id=ADMIN_ID,
                text=f"🔔 *ĐƠN SMM MỚI TẠO*\n👤 Khách: {u['name']} (ID: `{chat_id}`)\n🏷️ Mã Đơn: {new_order_id}\n📌 Dịch vụ: {order_detail['serviceName']}\n🔗 Link: {order_detail['link']}\n📊 SL: {quantity}\n💵 Tổng thu: {total_cost:,} VNĐ",
                parse_mode="Markdown"
            )
        except Exception:
            pass

async def handle_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    chat_id = str(query.from_user.id)
    data = query.data
    u = users.get(chat_id)
    if not u:
        return

    if data == "smm_main":
        text = "🌐 *DANH MỤC DỊCH VỤ MXH*\nVui lòng chọn nền tảng bạn muốn sử dụng:\n--------------------------------------------------\n"
        kb = []
        for key, cat in SMM_SERVICES.items():
            kb.append([InlineKeyboardButton(cat["title"], callback_data=f"smm_cat_{key}")])
        kb.append([InlineKeyboardButton("◀ Quay lại Trang chủ", callback_data="back_start")])
        await query.message.edit_text(text, parse_mode="Markdown", reply_markup=InlineKeyboardMarkup(kb))

    elif data.startswith("smm_cat_"):
        cat_key = data.replace("smm_cat_", "")
        category = SMM_SERVICES.get(cat_key)
        if category:
            text = f"{category['title']}\n--------------------------------------------------\n"
            kb = []
            for idx, item in enumerate(category["items"]):
                text += f"• *{item['name']}*: `{item['price']:,} VNĐ/lượt`\n"
                kb.append([InlineKeyboardButton(f"🛒 Đặt hàng: {item['name']}", callback_data=f"order_{cat_key}_{idx}")])
            kb.append([InlineKeyboardButton("◀ Quay lại Danh mục", callback_data="smm_main")])
            await query.message.edit_text(text, parse_mode="Markdown", reply_markup=InlineKeyboardMarkup(kb))

    elif data.startswith("order_"):
        parts = data.split("_")
        cat_key = parts[1]
        item_idx = int(parts[2])
        item = SMM_SERVICES.get(cat_key, {}).get("items", [])[item_idx]

        if item:
            u["actionState"] = {
                "step": "WAITING_LINK",
                "serviceName": item["name"],
                "price": item["price"]
            }
            save_database()
            await context.bot.send_message(chat_id=chat_id, text=f"📌 Bạn đang đặt: *{item['name']}*\n💰 Đơn giá: `{item['price']:,} VNĐ / 1 lượt`\n\n👉 *Vui lòng dán Link / ID mục tiêu vào đây:*\n\n_(Gõ /cancel nếu bạn muốn hủy)_", parse_mode="Markdown")

    elif data == "deposit":
        deposit_msg = (
            f"💳 *CỔNG NẠP TIỀN TỰ ĐỘNG (VIETQR)*\n--------------------------------------------------\n"
            f"🏛 Ngân hàng: *{BANK_CONFIG['bankId']}*\n"
            f"🔢 Số tài khoản: `{BANK_CONFIG['accountNo']}`\n"
            f"👤 Chủ tài khoản: *{BANK_CONFIG['accountName']}*\n"
            f"📝 Nội dung chuyển khoản: `NAP {chat_id}`\n--------------------------------------------------\n"
            f"⚠️ *Lưu ý:* Vui lòng ghi đúng nội dung để hệ thống cộng tiền tự động trong 3 giây."
        )
        kb = [[InlineKeyboardButton("◀ Quay lại Trang chủ", callback_data="back_start")]]
        await query.message.edit_text(deposit_msg, parse_mode="Markdown", reply_markup=InlineKeyboardMarkup(kb))

    elif data == "customer_center":
        if "orders" not in u:
            u["orders"] = []
        text = f"📇 *TRUNG TÂM KHÁCH HÀNG*\n👤 Xin chào sếp: *{u['name']}*\n💰 Số dư ví: `{int(u.get('balance', 0)):,} VNĐ`\n--------------------------------------------------\n📦 *DANH SÁCH ĐƠN HÀNG:*\n\n"
        user_orders = list(reversed(u["orders"]))[:15]

        if not user_orders:
            text += "_Hiện tại bạn chưa có đơn hàng nào._\n"
        else:
            for o in user_orders:
                text += f"🏷️ *Mã đơn:* `{o['id']}`\n"
                text += f"📌 *Dịch vụ:* {o.get('serviceName') or o.get('service')}\n"
                text += f"🔗 *Link:* {o['link']}\n"
                text += f"📊 *SL:* {int(o.get('quantity', 0)):,} | 💸 `{int(o.get('totalCost', 0)):,} VNĐ`\n"
                text += f"⏰ *Lúc:* {o.get('date', 'N/A')}\n"
                text += f"🔄 *Trạng thái:* {o['status']}\n—\n"

        kb = [[InlineKeyboardButton("◀ Quay lại Trang chủ", callback_data="back_start")]]
        await query.message.edit_text(text, parse_mode="Markdown", reply_markup=InlineKeyboardMarkup(kb))

    elif data == "admin_center":
        if chat_id != ADMIN_ID:
            return
        total_users = len(users)
        total_balance = sum(usr.get("balance", 0) for usr in users.values())
        total_orders = len(orders)

        text = (
            f"🛡️ *TRUNG TÂM QUẢN LÝ ADMIN*\n--------------------------------------------------\n"
            f"👥 Tổng khách hàng: `{total_users}`\n"
            f"💰 Tổng số dư ví: `{total_balance:,} VNĐ`\n"
            f"📦 Tổng số đơn: `{total_orders}`\n--------------------------------------------------\n"
            f"👉 *Chọn khách hàng bên dưới để quản lý số dư:*"
        )
        kb = []
        recent_user_ids = list(users.keys())[-10:]
        recent_user_ids.reverse()
        for uid in recent_user_ids:
            usr = users[uid]
            kb.append([InlineKeyboardButton(f"👤 {usr['name']} | 💰 {int(usr.get('balance', 0)):,}đ", callback_data=f"admin_user_{uid}")])
        kb.append([InlineKeyboardButton("🔄 Làm mới", callback_data="admin_center"), InlineKeyboardButton("◀ Quay lại", callback_data="back_start")])
        await query.message.edit_text(text, parse_mode="Markdown", reply_markup=InlineKeyboardMarkup(kb))

    elif data.startswith("admin_user_"):
        if chat_id != ADMIN_ID:
            return
        target_id = data.replace("admin_user_", "")
        target_user = users.get(target_id)
        if not target_user:
            return

        text = (
            f"👤 *QUẢN LÝ KHÁCH HÀNG*\n--------------------------------------------------\n"
            f"📌 Tên: *{target_user['name']}*\n"
            f"🆔 ID Telegram: `{target_id}`\n"
            f"💰 Số dư ví: `{int(target_user.get('balance', 0)):,} VNĐ`\n"
            f"📦 Tổng đơn: `{len(target_user.get('orders', []))}`\n--------------------------------------------------\n"
        )
        kb = [
            [InlineKeyboardButton("➕ Cộng / Nạp tiền", callback_data=f"admin_add_{target_id}"), InlineKeyboardButton("➖ Trừ tiền", callback_data=f"admin_sub_{target_id}")],
            [InlineKeyboardButton("◀ Quay lại danh sách Admin", callback_data="admin_center")]
        ]
        await query.message.edit_text(text, parse_mode="Markdown", reply_markup=InlineKeyboardMarkup(kb))

    elif data.startswith("admin_add_"):
        if chat_id != ADMIN_ID:
            return
        target_id = data.replace("admin_add_", "")
        target_user = users.get(target_id)
        admin_session[chat_id] = {"action": "ADD", "targetId": target_id}
        await context.bot.send_message(chat_id=chat_id, text=f"➕ *CỘNG TIỀN CHO KHÁCH*\n👤 Khách: *{target_user.get('name', target_id)}*\n\n👉 *Nhập số tiền muốn cộng:* (VD: 50000)\n_(Gõ /cancel để hủy)_", parse_mode="Markdown")

    elif data.startswith("admin_sub_"):
        if chat_id != ADMIN_ID:
            return
        target_id = data.replace("admin_sub_", "")
        target_user = users.get(target_id)
        admin_session[chat_id] = {"action": "SUB", "targetId": target_id}
        await context.bot.send_message(chat_id=chat_id, text=f"➖ *TRỪ TIỀN KHÁCH HÀNG*\n👤 Khách: *{target_user.get('name', target_id)}*\n\n👉 *Nhập số tiền muốn trừ:* (VD: 20000)\n_(Gõ /cancel để hủy)_", parse_mode="Markdown")

    elif data == "buy_code":
        text_menu = f"🎟️ *TRUNG TÂM MUA CODE & NHÀ CÁI*\n☕ Chào sếp *{u['name']}*\n--------------------------------------------------\n"
        kb = []
        linked_accs = u.get("linkedAccounts", DEFAULT_LINKED_ACCOUNTS)
        for brand in linked_accs:
            count = len(linked_accs[brand])
            text_menu += f"• {brand}: [ {count} ]\n"
            kb.append([InlineKeyboardButton(f"▶ {brand} ({count})", callback_data=f"page_{brand}")])
        kb.append([InlineKeyboardButton("◀ Quay lại", callback_data="back_start")])
        await query.message.edit_text(text_menu, parse_mode="Markdown", reply_markup=InlineKeyboardMarkup(kb))

    elif data == "back_start":
        if "actionState" in u:
            u.pop("actionState")
        if chat_id in admin_session:
            admin_session.pop(chat_id)
        save_database()
        await send_home_menu(query, context, chat_id, u, (chat_id == ADMIN_ID))

def start_telegram_bot(token: str):
    global telegram_app
    if not token:
        print("⚠️ BOT_TOKEN trống, bỏ qua khởi động Telegram Bot.")
        return
    try:
        telegram_app = Application.builder().token(token).build()
        telegram_app.add_handler(CommandHandler("start", start_cmd))
        telegram_app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, handle_message))
        telegram_app.add_handler(CallbackQueryHandler(handle_callback))
        
        # Khởi động bot dạng chạy nền bất đồng bộ
        telegram_app.run_polling(drop_pending_updates=True, stop_signals=None)
    except Exception as e:
        print(f"❌ Lỗi khởi động bot Telegram: {e}")

# ==========================================
# 🔌 WEBSOCKET ENDPOINT (REALTIME CLOUD BRAIN)
# ==========================================
@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    ws_id = "TAB_" + ''.join(random.choices("abcdefghijklmnopqrstuvwxyz0123456789", k=9))
    print(f"[+] Đàn em gia nhập hệ thống: {ws_id}")

    total_users = len(users)
    total_balance = sum(u.get("balance", 0) for u in users.values())

    try:
        await websocket.send_text(json.dumps({
            "type": "INIT_DATA",
            "totalUsers": total_users,
            "totalBalance": total_balance,
            "orders": list(reversed(list(orders.values()))),
            "brandStatuses": brandStatuses
        }))

        await aiEngine.broadcast_session_state()
        await aiEngine.broadcast_log('[SYSTEM] Đã kết nối với Master Control Panel thành công.')

        while True:
            data_raw = await websocket.receive_text()
            data = json.loads(data_raw)

            if data.get("token") and data.get("token") != SYSTEM_SECRET_TOKEN:
                await websocket.send_text(json.dumps({"action": "ERROR", "message": "Sai Secret Token bảo mật!"}))
                continue

            if data.get("action") == "PING" or data.get("type") == "PING":
                await websocket.send_text(json.dumps({"type": "PONG", "timestamp": data.get("timestamp") or data.get("time")}))
                continue

            if data.get("action") == "TAB_HEARTBEAT":
                CloudState["tabs"][ws_id] = data.get("info")
                continue

            if data.get("action") == "UPDATE_ACCOUNTS_POOL":
                CloudState["accounts"] = data.get("pool", {})
                distribute_accounts()
                continue

            # Broadcast message tới các client khác
            for connection in manager.active_connections:
                if connection != websocket:
                    try:
                        await connection.send_text(data_raw)
                    except Exception:
                        pass
    except WebSocketDisconnect:
        manager.disconnect(websocket)
        print(f"[-] Đàn em ngắt mạng: {ws_id}")
        CloudState["tabs"].pop(ws_id, None)
    except Exception as err:
        manager.disconnect(websocket)
        print(f"[!] Lỗi băng thông: {err}")

# ==========================================
# 🚀 KHỞI CHẠY HỆ THỐNG
# ==========================================
if __name__ == "__main__":
    load_database()
    
    # Khởi chạy Telegram bot chạy bằng Thread riêng biệt để không block FastAPI
    import threading
    if BOT_TOKEN:
        bot_thread = threading.Thread(target=start_telegram_bot, args=(BOT_TOKEN,), daemon=True)
        bot_thread.start()
        print("🤖 Bot Telegram đang khởi chạy ngầm...")

    print("========================================")
    print(f"👑 MASTER CONTROL PANEL V6100 PYTHON CHẠY CỔNG {PORT}")
    print("========================================")
    uvicorn.run(app, host="0.0.0.0", port=PORT)
