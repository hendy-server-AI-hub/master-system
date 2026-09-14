export default {
    async fetch(request, env, ctx) {
        // Chỉ chấp nhận phương thức POST để gửi đơn hàng
        if (request.method !== 'POST') {
            return new Response(JSON.stringify({ 
                success: false, 
                error: 'Method not allowed. Please use POST.' 
            }), {
                status: 405,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        try {
            // Đọc dữ liệu JSON gửi lên từ khách hàng hoặc giao diện Panel
            const orderData = await request.json();
            
            // Kiểm tra các trường dữ liệu cơ bản bắt buộc
            const { service_type, target_url, quantity, customer_id } = orderData;
            
            if (!service_type || !target_url || !quantity) {
                return new Response(JSON.stringify({ 
                    success: false, 
                    error: 'Thiếu thông tin đơn hàng (service_type, target_url, quantity).' 
                }), {
                    status: 400,
                    headers: { 'Content-Type': 'application/json' }
                });
            }

            // --- TÙY CHỌN: Đẩy đơn hàng vào Redis hoặc Database ---
            // Nếu bạn dùng Cloudflare KV hoặc kết nối Redis bên ngoài qua REST API, 
            // bạn có thể lưu trữ đơn hàng tại đây trước khi Worker Python đến lấy.
            // Ví dụ lưu vào Cloudflare KV (nếu đã cấu hình trong wrangler.toml):
            // await env.ORDERS_KV.put(`order_${Date.now()}`, JSON.stringify(orderData));

            // Phản hồi lại cho client rằng đã tiếp nhận đơn hàng thành công
            return new Response(JSON.stringify({
                success: true,
                message: 'Đã tiếp nhận đơn hàng thành công!',
                order_info: {
                    service: service_type,
                    target: target_url,
                    quantity: quantity,
                    received_at: new Date().toISOString()
                }
            }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' }
            });

        } catch (err) {
            return new Response(JSON.stringify({ 
                success: false, 
                error: 'Lỗi xử lý dữ liệu JSON: ' + err.message 
            }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' }
            });
        }
    }
};
