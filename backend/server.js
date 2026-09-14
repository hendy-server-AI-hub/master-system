const express = require('express');
const puppeteer = require('puppeteer'); // Đảm bảo đã cài đặt puppeteer
const app = express();

app.use(express.json());

// Middleware xác thực bảo mật từ Cloudflare Worker
const verifyInternalSecret = (req, res, next) => {
  const secret = req.headers['x-internal-secret'];
  if (!secret || secret !== process.env.INTERNAL_SECRET) {
    return res.status(403).json({ error: 'Unauthorized request from Edge' });
  }
  next();
};

// Endpoint nhận lệnh chạy Puppeteer
app.post('/api/smm/run-puppeteer', verifyInternalSecret, async (req, res) => {
  const { targetUrl, chatId } = req.body;

  try {
    console.log(`[Puppeteer Task] Bắt đầu cào dữ liệu cho URL: ${targetUrl} (ChatID: ${chatId})`);

    // Khởi chạy Puppeteer
    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    const page = await browser.newPage();
    
    await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: 30000 });
    
    // Ví dụ: Lấy tiêu đề trang web hoặc cào dữ liệu cấu trúc SMM
    const pageTitle = await page.title();
    const extractedData = {
      title: pageTitle,
      url: targetUrl,
      scrapedAt: new Date().toISOString()
    };

    await browser.close();

    console.log(`[Puppeteer Task] Hoàn thành cào dữ liệu thành công!`);
    return res.json({ success: true, data: extractedData });

  } catch (err) {
    console.error(`[Puppeteer Task Error]:`, err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Backend Express Server đang chạy trên cổng ${PORT}`);
});
