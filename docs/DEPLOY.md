# Đưa MATE lên mạng miễn phí: Render Free + Neon Free (không cần thẻ)

> **Muốn xem thử ngay, chưa cần đưa lên mạng?** Xem [TRY.md](TRY.md): chạy trên máy Mac bằng một lệnh, có sẵn dữ liệu mẫu.

## Tóm tắt

| | Render Free | Neon Free |
|---|---|---|
| Vai trò | Chạy app, cấp HTTPS và link `https://mate-xxxx.onrender.com` | **Lưu toàn bộ dữ liệu**: tài khoản, tin nhắn, hoá đơn, ảnh và tài liệu |
| Cần thẻ? | Không | Không |
| Giới hạn | Ngủ sau 15 phút không ai dùng. Lần mở đầu sau đó chờ khoảng 30–60 giây | 0,5 GB. Tự ngủ khi rảnh, thức lại trong khoảng 1 giây |
| Hết hạn? | Không (750 giờ/tháng) | Không |

> ⚠️ **Không tạo cơ sở dữ liệu trên Render.**
> - Postgres miễn phí của Render **bị xoá sau 30 ngày**.
> - Ổ đĩa của gói Free cũng bị xoá mỗi lần app khởi động lại.
>
> Mọi dữ liệu phải nằm ở **Neon**. Nếu quên nối Neon, app trên Render sẽ **từ chối chạy** thay vì âm thầm mất dữ liệu.

> 🔑 **Chuỗi kết nối Neon là bí mật**, giống mật khẩu: ai có nó là đọc và xoá được mọi dữ liệu.
> - **Chỉ** dán vào ô `DATABASE_URL` trong Render.
> - **Không** dán vào chat, email, tin nhắn, ảnh chụp màn hình, hay vào code trên GitHub.

Ảnh và tài liệu nằm trong Neon, mỗi nhà tối đa 50 MB, đặt bằng `HOUSEHOLD_QUOTA_MB`. Như vậy 10 người thử vẫn nằm trong 0,5 GB miễn phí.

Các bước dưới đây đánh dấu 🔒 là **việc chỉ Tom làm được**, vì cần tài khoản của Tom.

---

## Bước 1 — 🔒 Tạo cơ sở dữ liệu trên Neon (5 phút)

1. Vào **https://neon.tech** → **Sign up**. Đăng nhập bằng Google hoặc GitHub; không cần thẻ.
2. Tạo project:
   - **Project name:** `mate`;
   - **Region:** **AWS Asia Pacific (Singapore)**, cùng vùng với Render ở bước 2;
   - các ô khác để mặc định → **Create project**.
3. Neon hiện hộp **Connect to your database**. Bấm **Copy snippet** cạnh chuỗi dạng:
   `postgresql://neondb_owner:••••@ep-xxxx-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require`
4. Đây là **khoá bí mật**. Để yên trong clipboard, sang bước 2 dán ngay.

## Bước 2 — 🔒 Tạo app trên Render (10 phút, phần lớn là chờ)

1. Vào **https://render.com** → **Get Started** → đăng nhập bằng **GitHub**. Không cần thẻ.
2. Ở trang Dashboard bấm **New +** → **Blueprint**.
3. Nếu Render hỏi quyền GitHub, bấm **Configure account** → chọn repo **`Homeapp.`** → **Save**.
4. Chọn repo **`vucongtung2611-creator/Homeapp.`**:
   - **Branch:** `claude/loving-turing-nrtboc`, hoặc `main` nếu đã gộp nhánh;
   - **Blueprint Name:** `mate`.
5. Render đọc tệp `render.yaml` và hiện **một** dịch vụ web tên **mate** (gói **Free**, vùng **Singapore**). Không có mục database nào. Nếu thấy mục database thì đừng tạo.
6. Ở ô **DATABASE_URL**, dán chuỗi Neon từ bước 1.
7. Bấm **Deploy Blueprint**. ⏳ Lần đầu mất 5–10 phút.
8. Khi dịch vụ chuyển sang **Live** (chấm xanh), bấm vào **mate**. Link nằm ở đầu trang, dạng `https://mate-xxxx.onrender.com`. Đây là **link chung** để gửi cho người thử.
9. Kiểm tra: mở `https://mate-xxxx.onrender.com/api/health`, phải thấy `{"ok":true}`.

## Bước 3 — Thử ngay

1. Mở link trên điện thoại → **Get started** → tạo tài khoản → tạo nhà.
2. Vào ⚙️ → **Create invite link** → gửi link cho bạn.
3. Cài như app:
   - **iPhone:** mở bằng Safari → nút Chia sẻ → **Thêm vào MH chính**;
   - **Android:** mở bằng Chrome → ⋮ → **Cài đặt ứng dụng**.

## Bước 4 — Khi quay video: chat ngắt sau 30 phút

- Mặc định, chat **tự ngắt kết nối sau 3 phút** không chạm, gõ hay cuộn, hoặc khi tab bị ẩn đủ 3 phút. App hiện dòng *"Đã tạm ngắt để tiết kiệm pin…"*.
- Chạm vào bất kỳ đâu hoặc quay lại tab là app **tự nối lại và tải tin bị lỡ**.
- Nhờ vậy app trên Render được ngủ khi không ai thật sự dùng, tiết kiệm 750 giờ miễn phí.

Đổi thời gian ngắt:

1. Render → bấm dịch vụ **mate** → menu trái **Environment**.
2. Tìm `CHAT_IDLE_MINUTES` → **Edit** → đổi `3` thành `30` → **Save, rebuild, and deploy** (hoặc **Save changes**).
3. ⏳ Chờ khoảng 1–3 phút cho app khởi động lại.
4. Quay xong, đổi lại `3`.

## Bước 5 — Cập nhật khi có code mới

`render.yaml` đã bật `autoDeploy`: mỗi lần nhánh được đẩy code mới, Render tự dựng lại. Link và dữ liệu giữ nguyên.

Muốn dựng lại bằng tay: dịch vụ **mate** → **Manual Deploy** → **Deploy latest commit**.

## (Tuỳ chọn) Giữ app không ngủ

Mặc định app ngủ sau 15 phút không ai dùng; người mở đầu tiên sẽ chờ khoảng nửa phút. Nếu muốn tránh khi đang demo:

1. Vào **https://uptimerobot.com** → tạo tài khoản miễn phí.
2. Bấm **Add New Monitor**:
   - loại: **HTTP(s)**;
   - URL: `https://mate-xxxx.onrender.com/api/health`;
   - tần suất: mỗi **10 phút**.

Một app chạy liên tục dùng khoảng 744 giờ/tháng, vẫn trong 750 giờ miễn phí. Chỉ nên có **một** dịch vụ Free trong tài khoản Render khi bật cách này.

---

## Ai làm gì

| Việc | Ai |
|---|---|
| Tạo tài khoản Neon, copy chuỗi kết nối | 🔒 Tom |
| Đăng nhập Render bằng GitHub, cấp quyền repo | 🔒 Tom (chủ repo) |
| Dán chuỗi Neon vào ô `DATABASE_URL` | 🔒 Tom |
| Dockerfile, `render.yaml`, cấu hình, bảo mật, kiểm thử | Đã chuẩn bị sẵn |

## Bảo mật cơ bản (đã có sẵn)

- **HTTPS** do Render tự cấp. App tự bật cookie `Secure` và HSTS.
- **Không có khoá bí mật nào trong code.**
  - `DATABASE_URL` chỉ nằm trong phần Environment của Render.
  - Kết nối tới Neon luôn qua TLS có kiểm tra chứng chỉ.
- **Mật khẩu** băm bằng scrypt. **Phiên đăng nhập** lưu dạng băm, cookie `HttpOnly`.
- **Giới hạn số lần đăng nhập** theo IP và email; giới hạn riêng cho đăng ký và link mời.
- **Mỗi nhà tách riêng:** mọi API đều kiểm tra thành viên. Dữ liệu riêng tư chỉ người tạo thấy. Có test tự động cho từng điều này.
- **Lộ chuỗi kết nối?**
  1. Vào Neon → **Roles** → **Reset password**.
  2. Dán chuỗi mới vào Render (**Environment** → `DATABASE_URL` → **Save**). App tự khởi động lại.

## Gỡ rối

| Gặp | Làm |
|---|---|
| Logs của Render ghi `DATABASE_URL is not set` | Environment → thêm `DATABASE_URL` (chuỗi Neon) → Save |
| Logs ghi lỗi kết nối, `password authentication failed` | Copy lại chuỗi từ Neon (nút **Copy snippet**) và dán lại |
| Lần mở đầu chờ lâu | Bình thường: app đang thức dậy sau khi ngủ |

## Phương án dự phòng — Koyeb

1. Vào **https://www.koyeb.com** → đăng ký bằng GitHub.
2. **Create Service** → **GitHub** → chọn repo và nhánh như trên.
3. Thiết lập:
   - Builder: **Dockerfile**;
   - Instance: **Free**;
   - Exposed port: **3000**;
   - Health check: HTTP `/api/health`.
4. **Environment variables:**
   - `DATABASE_URL`: loại **Secret**, dán chuỗi Neon;
   - `TRUST_PROXY` = `1`;
   - `HOUSEHOLD_QUOTA_MB` = `50`;
   - `CHAT_IDLE_MINUTES` = `3`.
5. **Deploy**.

## Chạy thử Postgres trên máy (cho người làm kỹ thuật)

```bash
npm install && npm run build
node scripts/pg-dev.mjs                      # một Postgres tạm (PGlite) ở cổng 5433
DATABASE_URL=postgres://postgres@127.0.0.1:5433/postgres PG_POOL_MAX=1 npm start
```
