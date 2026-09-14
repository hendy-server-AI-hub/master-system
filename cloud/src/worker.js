export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const BOT_TOKEN = env.BOT_TOKEN || '8689114890:AAFBFM0rNtZWpOtAovIPHPVQTJVp0odU1DQ';

    // Cấu hình CORS dùng chung cho API
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    // 1. Xử lý kết nối WebSocket thời gian thực (Ping, Trạng thái mạng, Log)
    if (url.pathname === '/ws') {
      const upgradeHeader = request.headers.get('Upgrade');
      if (upgradeHeader !== 'websocket') {
        return new Response('Expected Upgrade: websocket', { status: 426 });
      }
      
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      
      server.accept();
      server.addEventListener('message', event => {
        try {
          const data = JSON.parse(event.data);
          // Phản hồi dữ liệu thời gian thực ngược lại client
          server.send(JSON.stringify({
            type: 'PONG_ACK',
            status: 'Connected',
            receivedPayload: data,
            timestamp: Date.now()
          }));
        } catch (e) {
          server.send(JSON.stringify({ error: 'Invalid JSON format' }));
        }
      });

      return new Response(null, {
        status: 101,
        webSocket: client,
      });
    }

    // 2. Xử lý Webhook từ Telegram Bot
    if (url.pathname === `/telegram-webhook/${BOT_TOKEN}` && request.method === 'POST') {
      try {
        const update = await request.json();
        if (update.message) {
          const chatId = update.message.chat.id;
          const text = update.message.text;
          
          // Gửi tin nhắn phản hồi qua Telegram Bot API
          await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: chatId,
              text: `[Hendy & Hades V6100 Cloud] Đã nhận lệnh: "${text}"`
            })
          });
        }
        return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders });
      }
    }

    // 3. API lấy trạng thái hệ thống & thông số mạng
    if (url.pathname === '/api/v1/status') {
      const systemStatus = {
        systemName: "Master Control Panel - Hendy & Hades V6100",
        core: "Cloudflare Edge Worker",
        status: "Active",
        latency: "12ms",
        timestamp: Date.now()
      };
      return new Response(JSON.stringify(systemStatus), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    return new Response('Hendy & Hades V6100 Cloud Edge is Online!', { status: 200, headers: corsHeaders });
  }
};
