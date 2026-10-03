# MATE: tính năng nào là thật?

Tài liệu này giúp nói trung thực với người xem hồ sơ hoặc video. Cập nhật đến đợt phản hồi A–K.

- **Thật:** đã chạy trên bản Render, có kiểm thử tự động (máy chủ và trình duyệt thật). Dùng được ngay với dữ liệu thật.
- **Bản thử:** chạy được nhưng còn đơn giản, hoặc chỉ mới làm một phần.
- **Ý tưởng:** chưa làm. Không có trong app, hoặc nếu có thì ghi rõ "sắp có".

## Thật

| Nhóm | Tính năng |
|---|---|
| Tài khoản | Đăng ký, đăng nhập; mật khẩu băm scrypt; chống thử mật khẩu theo IP, theo cặp IP + email, và theo email (từ nhiều địa chỉ) |
| Nhiều tài khoản trên một máy | Tối đa 5 tài khoản trên một trình duyệt; ⚙️ → Chuyển (không cần mật khẩu, không cần đăng xuất); thêm hoặc đăng xuất từng tài khoản |
| Vào nhà | Không tự tạo nhà sau đăng ký. Hai lựa chọn: vào bằng link/mã, hoặc tạo nhà mới |
| Thư mời | Link riêng cho từng người, dùng một lần, có vai trò, hạn 7 ngày, huỷ được |
| Mã nhà | 8 ký tự, chỉ để xin vào; sai 10 lần thì khoá 15 phút |
| Duyệt người mới | Bật mặc định. Chủ nhà hoặc quản lý đồng ý (chọn vai trò) hoặc từ chối. Người xin được báo kết quả |
| Hộp thư nhà | Số thư chưa đọc; yêu cầu xin vào; thư mời đã gửi và trạng thái; ai vào, rời, bị gỡ, đổi vai trò |
| Vai trò | Chủ nhà, Quản lý, Người ở, Khách (có hạn 1–90 ngày). Luôn còn ít nhất một chủ nhà. Chuyển quyền chủ nhà |
| Nhật ký nhà | Chủ nhà xem mọi thay đổi về người và quyền |
| Rời / gỡ / xoá nhà | Có xác nhận. Nhà trống của riêng mình thì xoá được |
| Chat | Chữ và ảnh, đến ngay (SSE). Tự ngắt sau 3 phút không dùng, tự nối lại và tải tin bị lỡ |
| Emoji, nhãn dán, tên nhóm | 48 emoji chèn đúng chỗ con trỏ; 12 nhãn dán có chữ theo ngôn ngữ người đọc; chủ nhà và quản lý đổi tên nhóm chat (cả nhà được báo) |
| Ảnh từ thư viện máy | Nút ảnh mở thư viện ảnh của điện thoại (hoặc máy ảnh, tuỳ máy) |
| Thư viện | Ghi chú, ảnh, tài liệu PDF; nhãn; tìm không dấu |
| Thư viện Cá nhân / Nhà | Công tắc hai chế độ. Cá nhân: không gian riêng cố định của mỗi người, chỉ mình thấy, giống nhau ở mọi nhà. Nhà: thư viện riêng của từng nhà, có bộ chọn nhà, các bộ sưu tập chỉ hiện ở chế độ Nhà |
| Ai nhìn thấy | Mỗi mục ghi rõ: Chỉ mình tôi / Cả nhà / Chủ nhà và quản lý (file đính kèm cũng theo đúng quyền đó) |
| Ví dụ mẫu | Nhà mới có sẵn ví dụ thực tế cho mọi bộ sưu tập; bộ sưu tập trống có nút "Thêm ví dụ mẫu"; xoá hết bằng một nút |
| Bộ sưu tập | Công thức, mong muốn, mua sắm, danh bạ, nội quy, hồ sơ thuê nhà; có mẫu sẵn và trạng thái trống |
| Hồ sơ thuê nhà | Loại giấy tờ (hợp đồng, cọc, biên bản, biên lai, sửa chữa), ngày, ngày hết hạn, số tiền |
| Nhắc hết hạn | Trong app: banner "sắp hết hạn" 30 ngày trước, nhãn đỏ khi đã hết hạn |
| Tìm và lọc | Theo chữ (kể cả ngày, số tiền), bộ sưu tập, loại, nhãn, kết hợp được |
| Hoá đơn | Dán chữ hoặc chụp ảnh → tách số tiền, hạn, kỳ (en, vi, fr, de, nl); chia đều; ai nợ ai; đánh dấu đã trả |
| Riêng tư | Mục riêng chỉ người tạo thấy; khách không thấy hoá đơn và mục riêng; người lạ nhận "không tìm thấy" |
| Xuất dữ liệu | Chủ nhà tải toàn bộ nhà thành .zip (data.json + ảnh, tài liệu). Không gồm mục riêng của người khác |
| Giao diện màu | Tự động (theo máy), Trắng ngà, Hồng nhạt, Xanh nhạt, Vàng nhạt, Tối; nhớ lựa chọn trên từng máy; độ tương phản chữ đạt chuẩn WCAG AA |
| Ảnh nhân vật | Chỗ gắn ảnh sẵn cho cả 5 nhân vật (xem `docs/CHARACTERS.md`). **Chưa có ảnh gốc nào**: James, Timothy, Ella, Nolan dùng hình nét mực tạm có chữ cái đầu, Tom dùng hình nét mực của Tom |
| Lịch trong nhà | Tab Lịch cạnh Chat. Xem tháng và tuần; lọc theo người (mỗi người một màu), theo nhãn (ví dụ tên con, "Đối tác" khi dùng cho văn phòng) hoặc "Của tôi". Mỗi lịch hẹn có giờ bắt đầu và kết thúc, ghi chú, ai được xem (cả nhà / chủ nhà và quản lý / chỉ mình). Người thêm, chủ nhà hoặc quản lý sửa được; khách chỉ xem. Cập nhật ngay trên mọi máy |
| Từ chat sang lịch | Tin nhắn có ngày giờ ("thứ 7 lúc 9h", "tối mai 7h", "7/10", "demain à 18h", "am Freitag um 8"…) hiện nút "📅 Thêm vào lịch nhà", mở sẵn ngày, giờ và nội dung. Nhận diện bằng quy tắc, không dùng AI |
| Nhắc hẹn khi mở app | Thanh nhắc lịch hôm nay và ngày mai (của mình hoặc của cả nhà); ẩn được, ẩn thì không hiện lại trong ngày |
| Hướng dẫn lần đầu | 4 bước, dùng tốt trên điện thoại, bỏ qua được, xem lại được |
| Ngôn ngữ | Tiếng Anh, Việt, Pháp, Đức, Hà Lan; thông báo lỗi dễ hiểu (có kiểm thử bảo đảm mọi lỗi đều có câu dịch) |
| Chạy thử trên máy | `npm run try`: một nhà mẫu, 4 tài khoản |

## Bản thử (nói rõ khi giới thiệu)

| Tính năng | Giới hạn hiện tại |
|---|---|
| Nhắc hết hạn | Chỉ hiện khi mở app. **Chưa** gửi email hay thông báo đẩy |
| Nhắc lịch hẹn | Chỉ hiện khi mở app. **Chưa** gửi email hay thông báo đẩy. Chưa có lịch lặp lại (hằng tuần, hằng tháng) |
| Nhận diện ngày giờ trong chat | Chỉ bắt các cách nói phổ biến; câu mơ hồ ("hôm nào rảnh") thì không gợi ý |
| Đọc hoá đơn từ ảnh | Chạy ngay trên điện thoại, chưa dùng AI; ảnh mờ hoặc hoá đơn lạ có thể đọc sai, người dùng kiểm tra lại trước khi lưu |
| Khách hết hạn | Bị gỡ khi có người mở app lần kế tiếp, không đúng phút |
| Dung lượng | Mỗi nhà 50 MB ảnh và tài liệu (gói miễn phí của Neon) |
| Máy chủ miễn phí (Render) | Ngủ sau 15 phút không ai dùng; lần mở đầu chờ khoảng 30–60 giây |

## Ý tưởng (chưa làm, không có trong app)

- Phía chủ nhà cho thuê: hồ sơ thuê nhà hiện là nền dữ liệu cho phần này; chưa có tài khoản hay màn hình cho chủ nhà cho thuê.
- Kết nối Gmail để tự đọc hoá đơn và bưu kiện từ email.
- Bưu kiện, dùng khi mất mạng.
- Nhắc lịch hẹn qua email và thông báo đẩy (cần dịch vụ gửi thư hoặc đăng ký push; hiện chỉ nhắc trong app).
- Kết nối tài khoản thanh toán thật (ngân hàng, ví) để trả hoá đơn ngay trong app. **Không làm trong đợt này**: cần đối tác thanh toán, giấy phép và kiểm tra bảo mật; hiện app chỉ ghi nhận "đã trả".
- Trợ lý AI trong nhà ("butler").
