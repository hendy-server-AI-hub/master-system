export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Endpoint nhận lệnh từ Telegram hoặc Dashboard muốn cào dữ liệu bằng Puppeteer
    if (url.pathname.startsWith('/telegram-webhook')) {
      if (request.method !== 'POST') {
        return new Response('Method not allowed', { status: 405 });
      }

      try {
        const update = await request.json();
        
        if (update.message && update.message.text) {
          const chatId = update.message.chat.id;
          const text = update.message.text;
          const botToken = env.BOT_TOKEN;

          // Kiểm tra nếu người dùng gõ lệnh cào dữ liệu (ví dụ: /crawl <url>)
          if (text.startsWith('/crawl')) {
            const targetUrl = text.split(' ')[1]; // Lấy URL cần cào phía sau lệnh

            if (!targetUrl) {
              await sendTelegramMessage(botToken, chatId, "⚠️ Vui lòng nhập URL cần cào, ví dụ: /crawl https://example.com");
              return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } });
            }

            // Gửi thông báo đang xử lý
            await sendTelegramMessage(botToken, chatId, `🔄 Đang chuyển yêu cầu sang Backend Express để chạy Puppeteer cào dữ liệu từ: ${targetUrl}...`);

            // --- GỌI SANG BACKEND EXPRESS ---
            try {
              const backendResponse = await fetch(`${env.BACKEND_API_URL}/api/smm/run-puppeteer`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'X-Internal-Secret': env.INTERNAL_SECRET // Khóa bảo mật giữa Worker và Backend
                },
                body: JSON.stringify({ targetUrl, chatId })
              });

              const backendResult = await backendResponse.json();

              if (!backendResponse.ok) {
                throw new Error(backendResult.error || 'Backend Express gặp lỗi khi chạy Puppeteer.');
              }

              // Phản hồi kết quả cào được về Telegram
              await sendTelegramMessage(botToken, chatId, `✅ Cào dữ liệu thành công!\nKết quả: ${JSON.stringify(backendResult.data).substring(0, 300)}...`);

            } catch (err) {
              await sendTelegramMessage(botToken, chatId, `❌ Lỗi kết nối Backend Express: ${err.message}`);
            }

          } else {
            // Phản hồi lệnh thông thường khác
            await sendTelegramMessage(botToken, chatId, `[Hendy & Hades V6100 Cloud] Đã nhận lệnh: "${text}"`);
          }
        }

        return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } });
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
      }
    }

    return new Response('Hendy & Hades V6100 Edge Worker Active', { headers: { 'Content-Type': 'text/plain' } });
  }
};

// Hàm phụ trợ gửi tin nhắn Telegram
async function sendTelegramMessage(token, chatId, text) {
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text })
  });
}
