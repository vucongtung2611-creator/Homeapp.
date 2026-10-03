# Xem thử MATE trên máy Mac — không cần đưa lên mạng

Mọi thứ chạy trên máy của bạn. Dữ liệu nằm trong thư mục `demo-data` và không gửi đi đâu.

## Lần đầu (khoảng 10 phút)

**1. Cài Node.js** (chỉ làm một lần)
- Vào https://nodejs.org và bấm nút tải bản **LTS**.
- Mở tệp `.pkg` vừa tải, bấm **Continue** / **Install** đến hết.
- Nếu máy hỏi mật khẩu, nhập mật khẩu máy Mac.

**2. Tải MATE**
- Mở https://github.com/vucongtung2611-creator/Homeapp./tree/claude/loving-turing-nrtboc
- Bấm nút xanh **<> Code** → **Download ZIP**.
- Vào thư mục **Downloads** (Tải về), bấm đúp tệp ZIP để giải nén.

**3. Mở Terminal**
- Bấm **⌘ + Space**, gõ `Terminal`, bấm **Enter**.

**4. Đi vào thư mục MATE**
- Gõ `cd` rồi gõ **một dấu cách**.
- **Kéo thư mục vừa giải nén thả vào cửa sổ Terminal.**
- Bấm **Enter**.

**5. Chạy MATE** — gõ lệnh này rồi bấm **Enter**:

```
npm run try
```

⏳ Lần đầu mất 2–5 phút. Xong, trình duyệt tự mở **http://localhost:3000**.

Nếu Terminal báo `command not found: npm`: đóng Terminal, mở lại, rồi làm lại bước 4 và 5.

## Đăng nhập

Mật khẩu chung cho cả bốn tài khoản: **`mate-demo-2026`**

| Người | Email |
|---|---|
| Tom (chủ nhà) | `tom@mate.demo` |
| Linh | `linh@mate.demo` |
| Minh | `minh@mate.demo` |
| Bảo | `bao@mate.demo` |

## Có sẵn gì

Cả bốn người ở chung **Nhà số 7**.

**Chat**
- Vài tin nhắn qua lại, có một ảnh pizza.
- Thông báo tự động khi có hoá đơn mới hoặc có người trả tiền.

**Thư viện**
- Các bộ sưu tập: công thức nấu ăn, danh sách mong muốn, mua sắm, danh bạ, nội quy nhà, hồ sơ thuê nhà.
- Wi‑Fi, lịch đổ rác, nội quy nhà, công thức phở của Bảo, số điện thoại chủ nhà.
- **Hồ sơ thuê nhà:** hợp đồng (PDF, hết hạn sau 25 ngày nên app hiện nhắc) và tiền cọc.
- Ảnh đồng hồ điện.
- Một ghi chú **riêng tư** của Tom: "Quà sinh nhật Linh". Chỉ Tom thấy; đăng nhập bằng Linh để kiểm tra.

**Hoá đơn**
- Tiền điện **1.180.000 đ**, tách tự động từ email của EVN: số tiền, hạn trả, kỳ thanh toán.
  - Linh đã trả, app chia đều cho 4 người.
- Tiền Internet chưa trả.
- Một lần đi chợ chung.
- Mục **Ai nợ ai**.

**Lịch** (tab mới cạnh Chat)
- Xem tháng / tuần, lọc theo người hoặc nhãn. Bấm "Thêm" để tạo lịch hẹn.
- Viết trong chat "thứ 7 lúc 9h đi bơi" → dưới tin nhắn có nút "📅 Thêm vào lịch nhà".
- "Việc nhà": bấm gợi ý "Đổ rác" (xoay vòng) hay "Đổi mật khẩu wifi" (3 tháng/lần), rồi đánh dấu xong để chuyển lượt.
- "🔗 Dùng trong Google hoặc Apple Calendar": tải file .ics hoặc tạo link đăng ký.

**Chọn người trò chuyện** (nút có tên nhóm ở đầu khung chat)
- Nhắn riêng với một người: chỉ hai người thấy.
- MATE, James, Timothy, Ella, Nolan (bản thử, không có AI): thử "ghi chú: …", "lịch: mai 8h …", "tìm wifi", "gợi ý cho mình".

**Hộp thư, vai trò, nhật ký** (đăng nhập bằng Tom)
- Biểu tượng hộp thư cạnh ⚙️: ai đã vào nhà, thư mời đã gửi.
- ⚙️ Cài đặt: đổi vai trò từng người (Quản lý, Khách…), nhật ký nhà, tải toàn bộ dữ liệu (.zip).
- Lần đầu vào nhà có hướng dẫn nhanh 4 bước; xem lại ở ⚙️ → "Xem lại hướng dẫn nhanh".

## Mẹo quay video

- **Hai người nhắn tin với nhau**
  - Mở thêm cửa sổ ẩn danh (**⌘ + Shift + N**) và đăng nhập người thứ hai.
  - Đặt hai cửa sổ cạnh nhau: tin gửi bên này hiện ngay bên kia.
- **Xem trên điện thoại**
  - Điện thoại dùng chung Wi‑Fi với Mac.
  - Mở địa chỉ ở dòng *"Điện thoại cùng Wi‑Fi"* mà Terminal in ra.
- **Đổi ngôn ngữ:** vào ⚙️ → Language.
  - Muốn dữ liệu mẫu bằng tiếng Anh, chạy `npm run try -- --en`.
- **Chat tự ngắt:** trên máy, chat chỉ tự ngắt sau **30 phút** không thao tác, nên không bị ngắt giữa lúc quay.

## Lần sau

Mở Terminal, làm lại bước 4, rồi gõ:

| Muốn | Gõ |
|---|---|
| Bắt đầu lại với dữ liệu mẫu mới | `npm run try` |
| Giữ những gì đã làm lần trước | `npm run try -- --keep` |
| Tắt MATE | Bấm **Ctrl + C** trong Terminal |
