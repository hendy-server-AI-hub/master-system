export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // 1. Xử lý Telegram Webhook Endpoint
    if (url.pathname.startsWith('/telegram-webhook')) {
      if (request.method !== 'POST') {
        return new Response('Method not allowed', { status: 405 });
      }

      try {
        const update = await request.json();
        
        // Kiểm tra nếu có tin nhắn văn bản gửi đến bot
        if (update.message && update.message.text) {
          const chatId = update.message.chat.id;
          const text = update.message.text;
          
          // Lấy token bảo mật từ Cloudflare Secret (hoặc fallback)
          const botToken = env.BOT_TOKEN || "8689114890:AAFBFM0rNtZWpOtAovIPHPVQTJVp0odU1DQ";

          // Gửi tin nhắn phản hồi tự động lại cho người dùng
          await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: chatId,
              text: `[Hendy & Hades V6100 Cloud] Đã nhận lệnh: "${text}"`
            })
          });
        }

        return new Response(JSON.stringify({ ok: true }), {
          headers: { 'Content-Type': 'application/json' }
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), { 
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        });
      }
    }

    // 2. Endpoint kiểm tra trạng thái hệ thống
    if (url.pathname === '/api/v1/status' || url.pathname === '/status') {
      return new Response(JSON.stringify({ 
        status: 'online', 
        system: 'Hendy & Hades V6100 Master Control Panel',
        timestamp: new Date().toISOString()
      }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // 3. Phản hồi mặc định cho trang chủ worker
    return new Response('Hendy & Hades V6100 Edge Worker is active and running!', {
      headers: { 'Content-Type': 'text/plain' }
    });
  }
};
