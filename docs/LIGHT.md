# MATE — bản dùng thử

**MATE** = **M**anage · **A**ssist · **T**ogether · **E**veryday — người bạn đồng hành của cả nhà.

Bản web dùng thử để gửi cho bạn bè qua đường dẫn. Thiết kế cho điện thoại trước, gồm 3 tab: **Chat**, **Thư viện**, **Hóa đơn**.

## Phạm vi

| Có | Để sau |
|---|---|
| Đăng ký/đăng nhập bằng email + mật khẩu, tạo nhà, mời người bằng link | Bưu kiện, dùng khi mất mạng, xuất dữ liệu |
| Chat trong nhà: chữ + ảnh, tin đến ngay (Server-Sent Events) | Thông báo đẩy (push) |
| Thư viện: ghi chú, ảnh, tài liệu PDF, nhãn, tìm kiếm không cần dấu, món riêng tư | Bếp, tủ quần áo, tủ phim (dùng lại cấu trúc món đồ) |
| Hóa đơn: dán chữ hoặc chụp ảnh → tách số tiền, hạn trả, kỳ thanh toán → chia tiền → ai nợ ai | Quên mật khẩu qua email, xoá tài khoản |
| Dữ liệu mẫu cho nhà mới (xoá được), trạng thái đang tải / trống / lỗi | Cộng đồng, wishlist |

## Ngôn ngữ

- Mọi chữ trên giao diện nằm trong `web/src/i18n/locales/`. `en.ts` là bản gốc và là ngôn ngữ mặc định. `vi.ts`, `fr.ts`, `de.ts`, `nl.ts` dịch đủ 100%: chúng được khai báo kiểu `Messages`, nên thiếu một khoá là build báo lỗi. Bộ tách hóa đơn và OCR cũng hiểu tiếng Pháp, Đức, Hà Lan.
- **Thêm hoặc hoàn thiện một ngôn ngữ:** dịch các khoá trong file của ngôn ngữ đó. Khoá nào chưa dịch sẽ hiện tiếng Anh. Khi dịch được khoảng 90%, ngôn ngữ đó tự xuất hiện trong nút chọn, không cần sửa code. Ngôn ngữ hoàn toàn mới thì thêm một dòng trong `locales/index.ts`.
- Tự nhận ngôn ngữ theo trình duyệt. Nút đổi ngôn ngữ nằm ở màn hình chào, màn hình đăng nhập và trong Cài đặt. Lựa chọn được lưu trên máy.
- Tiền, ngày, giờ, danh sách và tên tiền tệ đều dùng `Intl` theo ngôn ngữ đang chọn. Số nhiều dùng `Intl.PluralRules`.
- Tin nhắn hệ thống trong chat ("An đã vào nhà"…) được lưu dạng mã + tham số, nên mỗi người đọc bằng ngôn ngữ của mình. Tin nhắn người dùng gõ không bao giờ bị dịch.
- Dữ liệu mẫu của nhà mới theo ngôn ngữ người tạo (`server/samples.ts`).
- `npm test` chạy `scripts/check-i18n.mjs`, sẽ báo lỗi nếu có chữ viết cứng trong giao diện.
- Phông Inter tự host, gồm bộ Latin, Latin mở rộng (cho tiếng Pháp, Đức) và tiếng Việt.

## Nhân vật

- Năm nhân vật được khai báo **ở một nơi duy nhất** là `src/characters.ts`:
  - **Tom:** linh vật dẫn đường, không có màu riêng, là ảnh đại diện mặc định. Sau này người dùng sẽ tự chỉnh tóc và trang phục cho Tom.
  - **James:** ông già.
  - **Timothy:** chàng nghệ sĩ.
  - **Ella:** người phụ nữ.
  - **Nolan:** cậu bé.
- Tên và mô tả nằm trong các file dịch.
- **Ảnh thật:** thả vào `web/public/characters/<id>/` theo quy ước tên file, tất cả là ảnh nét mực nền trong suốt, cùng một khung vuông:
  - `avatar.webp`: ảnh đứng yên;
  - `blink.webp`: cùng tư thế, mắt nhắm → nhân vật tự chớp mắt;
  - `wave.webp`: đang vẫy tay → dùng khi chào;
  - `<phòng>.webp`: nhân vật trong một phòng, ví dụ `james/library.webp`;
  - `tom/layers/hair/*.webp` và `tom/layers/outfit/*.webp`: lớp tóc và trang phục vẽ chồng lên Tom.
- Lúc build, các thư mục được quét tự động: **thả ảnh vào rồi deploy lại là chạy**, không sửa code.
- **Hoạt hoạ:** chỉ dùng CSS (transform và opacity), không thư viện:
  - thở nhẹ;
  - chớp mắt: hình giữ chỗ của Tom có mắt chớp, ảnh thật dùng `blink.webp`;
  - vẫy tay khi chào: dùng `wave.webp` nếu có, không thì lắc nhẹ;
  - nảy một cái khi có tin nhắn mới.
- Tự tắt hết hoạt hoạ khi hệ điều hành bật "giảm chuyển động". Danh sách dài dùng chế độ đứng yên để nhẹ máy.

## Kiến trúc

```
Trình duyệt (Preact, 90 KB)            Server Node 22 (Hono)                 Đĩa
 ├─ OCR trên máy (tesseract, tự host) ─┐ ├─ /api/*  đăng nhập, quyền          ├─ homeapp.db (SQLite)
 ├─ bộ tách hóa đơn (src/integrations) │ ├─ SSE    tin nhắn tức thời         │   users, sessions, invites,
 └─ thu nhỏ ảnh + xoá EXIF             │ └─ lõi Household Graph (src/)       │   messages, files,
                                       └────────────────────────────────────┘   households.graph (JSON)
                                                                              └─ files/<id ngẫu nhiên>
```

- **Lõi dùng lại:** mỗi nhà là một Household Graph (`src/`), được lưu thành một bản JSON trong SQLite và giữ trong bộ nhớ khi đang chạy. Quyền xem đi qua `AccessControl`. Chia tiền dùng `Finance` (chỉ chi phí đánh dấu *chung* mới được chia, tính tròn theo đơn vị tiền tệ, VND không có số lẻ).
- **Thư viện:** module `Items` (`src/modules/items.ts`) là cấu trúc món đồ chung, gồm `space` / `kind` / `tags` / `attachments` / `attributes`. Sau này bếp chỉ cần `space: 'kitchen'` với `attributes: { expiresOn }`, tủ quần áo dùng `space: 'wardrobe'`.
- **Chat** không nằm trong graph: tin nhắn ghi nhiều và cần phân trang, nên lưu trong bảng riêng.
- **Bộ tách hóa đơn** (`src/integrations/understand.ts`) chạy được cả ở server lẫn trình duyệt. Người dùng luôn xem lại và sửa trước khi lưu.

## Lưu dữ liệu và đăng nhập: chọn cách đơn giản nhất

- **SQLite qua `node:sqlite`** có sẵn trong Node 22: không cần thư viện native, không cần dịch vụ cơ sở dữ liệu. Một file, sao lưu bằng cách chụp ảnh ổ đĩa (snapshot). Giới hạn: chỉ chạy **một máy**, đủ cho vài chục nhà dùng thử.
- **Tài khoản email + mật khẩu.** Mật khẩu băm bằng scrypt, phiên là cookie httpOnly/SameSite=Lax và chỉ lưu dạng băm. Không cần dịch vụ gửi email. Đổi lại thì chưa có "quên mật khẩu". Khi cần, thêm đăng nhập bằng link email (ví dụ qua Resend).

## Đưa lên một đường dẫn chung

> **Phương án đang dùng: [Render Free + Neon Free](DEPLOY.md)**, không cần thẻ. Chạy thử trên máy bằng một lệnh: [TRY.md](TRY.md). Phần dưới đây là các phương án trả phí cũ.

App đóng gói bằng `Dockerfile`, cần ổ đĩa lâu dài gắn vào `/data`.

**Cách A: Render (bấm trên web, không cần dòng lệnh, khoảng 10 phút, Starter $7/tháng vì cần ổ đĩa)**
1. render.com → New → **Blueprint** → chọn repo này và nhánh của bản Light.
2. Render đọc `render.yaml`, tạo dịch vụ có ổ đĩa 1 GB ở `/data`.
3. Sau khi deploy xong, link có dạng `https://homeapp-light.onrender.com`. Có thể đặt biến `PUBLIC_URL` bằng link này (không bắt buộc).

> Đừng dùng gói Free của Render: không có ổ đĩa, nên mỗi lần khởi động lại sẽ **mất hết dữ liệu**.

**Cách B: Fly.io (dòng lệnh, có gói rẻ, máy ở Singapore)**
```bash
fly launch --copy-config --no-deploy      # đổi tên app nếu "homeapp-light" đã có người dùng
fly volumes create homeapp_data --size 1 --region sin
fly deploy
```

Cả hai đều có HTTPS sẵn. App tự nhận biết HTTPS và tên miền qua proxy (`TRUST_PROXY=1`).

**Chạy trên máy:**
```bash
npm install
npm run build
npm start            # http://localhost:3000, dữ liệu trong ./data
```

## Kiểm tra

- `npm test`: kiểm tra chữ viết cứng, kiểu dữ liệu, và 65 bài test, gồm đăng nhập, phân quyền, tải tệp, chat tức thời, chia tiền, khởi động lại server không mất dữ liệu, và các bản sửa bảo mật.
- `node scripts/e2e.mjs`: chạy Chromium thật với 2 người trên khung iPhone. Kịch bản: tiếng Anh mặc định → đổi sang tiếng Việt, tải lại vẫn giữ → phông có đủ dấu Việt/Pháp/Đức → đăng ký → tạo nhà → mời → người thứ hai vào → chat chữ và ảnh tức thời → thư viện (riêng tư, tìm không dấu, nhãn) → dán hóa đơn → chia → trả → sòng phẳng → chi tiêu chung → chụp hóa đơn đọc bằng OCR → trạng thái lỗi khi mất mạng → đăng xuất.

## Rà bảo mật (trước khi đưa lên mạng)

**Đăng nhập**
- scrypt (N=16384) và so sánh thời gian cố định. Sai email hay sai mật khẩu đều trả cùng một lỗi, và tốn cùng thời gian.
- Token phiên 256 bit, chỉ lưu dạng băm SHA-256, hết hạn sau 30 ngày. Đăng xuất là xoá phiên.
- Cookie `HttpOnly`, `SameSite=Lax`, tự thêm `Secure` khi chạy HTTPS.
- Chống CSRF: mọi request ghi phải có header `X-Requested-With: homeapp`, và Origin phải trùng tên miền.
- Giới hạn tần suất: đăng nhập theo IP+email và theo IP, đăng ký theo IP. IP lấy từ giá trị do proxy ghi (`Fly-Client-IP` hoặc mục cuối của `X-Forwarded-For`), không tin phần do người dùng gửi lên.
- *Đã sửa trong lúc rà:* trước đó IP được lấy từ mục đầu của `X-Forwarded-For`, nên giả mạo được để né giới hạn. Có test chứng minh đã chặn được.

**Mời người**
- Link mời chứa token 256 bit, chỉ lưu dạng băm, hết hạn sau 7 ngày. Tạo link mới thì link cũ mất hiệu lực, và có nút huỷ link.
- Xem trước link chỉ hiện tên nhà và tên người mời, không có danh sách thành viên hay dữ liệu gì khác.
- `Referrer-Policy: no-referrer` để token không lộ qua header Referer.
- Người được mời vào với vai trò *ở chung*, không bao giờ là chủ nhà. Mỗi nhà tối đa 20 người.
- Chủ nhà mời được người ra. Người bị mời ra mất quyền ngay, kể cả kết nối chat đang mở.

**Dữ liệu riêng tư**
- Mọi API của một nhà đều kiểm tra thành viên. Người ngoài nhận 404, nên không dò được id nhà.
- Món thư viện riêng tư, hóa đơn riêng và chi tiêu riêng chỉ người tạo thấy. Tìm kiếm và đếm nhãn cũng đi qua cùng bộ lọc quyền.
- *Đã sửa:* id thuộc nhà khác trước đây trả lỗi 500 (dù không lộ dữ liệu), nay trả 404.
- Ai nợ ai chỉ tính từ chi phí chung. Ghi nhận "đã trả" được thông báo vào chat để cả nhà cùng thấy.

**Tải ảnh/tệp lên**
- Chỉ nhận JPEG/PNG/WebP/GIF/PDF, xác định bằng byte đầu tệp chứ không tin Content-Type. Không nhận SVG hay HTML.
- Tối đa 10 MB mỗi tệp (đếm trong lúc nhận), 500 MB mỗi nhà. Tên tệp trên đĩa là id ngẫu nhiên.
- Khi trả tệp về: dùng đúng loại đã xác định, thêm `nosniff` và `CSP: sandbox`. PDF luôn tải xuống.
- Ai được tải tệp: người đã tải lên, cả nhà nếu tệp nằm trong chat, hoặc người xem được món thư viện có đính kèm tệp đó. Không đính kèm được tệp của người khác để "mượn quyền".
- Ảnh được thu nhỏ và xoá EXIF (gồm vị trí GPS) ngay trên điện thoại. Ảnh hóa đơn dùng để đọc chữ không rời khỏi máy.

**Còn lại (chấp nhận được cho bản thử, cần làm trước khi mở rộng)**
- Chưa có "quên mật khẩu" và xoá tài khoản.
- Server chưa tự xoá EXIF: người dùng cố tình bỏ qua bước trên máy thì ảnh vẫn giữ EXIF.
- Một thành viên có thể ghi "tôi đã trả" mà người nhận không cần xác nhận. Chat có thông báo, nhưng chưa có bước xác nhận.
- Tệp tải lên rồi bỏ dở không đính kèm vào đâu thì chưa được dọn.
- Chỉ chạy một máy, giới hạn tần suất lưu trong bộ nhớ.
