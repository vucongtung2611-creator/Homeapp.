# Đưa MATE lên mạng miễn phí — hướng dẫn từng bước

## Dữ liệu đang được lưu ở đâu?

| Chế độ | Khi nào | Lưu ở đâu |
|---|---|---|
| **SQLite** | Không đặt `DATABASE_URL` (chạy trên máy, chạy test) | Một tệp `data/homeapp.db`. Ảnh nằm ngay trong tệp này. |
| **Postgres** | Có `DATABASE_URL` (khi đưa lên mạng) | Cơ sở dữ liệu Postgres, ví dụ Neon. Mọi thứ, kể cả ảnh, nằm trong đó. Máy chủ web không cần ổ đĩa. |

Lý do phải dùng Postgres khi đưa lên mạng: gói miễn phí của Render và Koyeb **xoá sạch ổ đĩa mỗi lần máy khởi động lại hoặc ngủ dậy**. Nếu dùng tệp SQLite thì mọi tài khoản, tin nhắn và hóa đơn sẽ mất. Neon giữ dữ liệu lâu dài, và gói miễn phí không hết hạn.

Mỗi nhà là một bản ghi riêng trong cơ sở dữ liệu, có kiểm tra thành viên ở mọi API. Người không thuộc nhà sẽ nhận lỗi "không tìm thấy", không thấy được gì.

## Phương án đề xuất (hoàn toàn miễn phí)

**Render (gói web Free) + Neon (Postgres Free)**

| | Render Free | Neon Free |
|---|---|---|
| Vai trò | Chạy app, cấp HTTPS và link `https://mate-xxxx.onrender.com` | Lưu dữ liệu |
| Giới hạn chính | Ngủ sau 15 phút không ai dùng. Lần mở đầu tiên sau đó chờ khoảng 30–60 giây | 0,5 GB lưu trữ. Tự ngủ khi rảnh, thức lại trong khoảng 1 giây |
| Hết hạn? | Không (750 giờ/tháng, đủ chạy liên tục) | Không |

Vì sao không chọn các phương án khác:

- **Postgres của Render:** gói miễn phí hết hạn sau 30 ngày.
- **Fly.io:** không còn gói miễn phí cho tài khoản mới.
- **Koyeb:** cũng miễn phí và dùng được. Bước làm ở cuối tài liệu, dùng nếu Render gặp trục trặc.
- **Supabase:** cũng có Postgres miễn phí, nhưng dự án tự tạm dừng sau 1 tuần không hoạt động. Neon hợp hơn cho bản chạy thử.

Mỗi nhà được dùng tối đa 50 MB cho ảnh và tài liệu (đặt bằng `HOUSEHOLD_QUOTA_MB`), để cả nhóm bạn không vượt 0,5 GB của Neon.

---

## Các bước — những việc chỉ Tom làm được

> Mình đã chuẩn bị sẵn toàn bộ code và cấu hình (`Dockerfile`, `render.yaml`). Tom chỉ cần tạo tài khoản và bấm nút.
> **Không dán chuỗi kết nối cơ sở dữ liệu vào chat, email hay vào code.** Chỉ dán vào ô cài đặt của Render.

### Bước 1 — Tạo cơ sở dữ liệu trên Neon (khoảng 3 phút)

1. Vào **https://neon.tech** → **Sign up**. Nên đăng nhập bằng GitHub.
2. Tạo project mới:
   - Tên: `mate`.
   - Postgres version: để mặc định.
   - Region: **AWS Europe Central (Frankfurt)**. Chọn Singapore nếu bạn bè chủ yếu ở Việt Nam, và nhớ chọn region Render tương ứng ở bước 2.
3. Ở màn hình **Connection details**, chọn **Connection string** rồi bấm **Copy**. Chuỗi có dạng
   `postgresql://neondb_owner:••••@ep-xxxx-pooler.eu-central-1.aws.neon.tech/neondb?sslmode=require`
   Đây là **khoá bí mật**. Giữ trong clipboard, chưa dán đi đâu cả.

### Bước 2 — Tạo app trên Render (khoảng 10 phút, phần lớn là chờ build)

1. Vào **https://render.com** → **Get Started**. Đăng nhập bằng **GitHub** và cho Render quyền đọc repo `Homeapp.`. Người cấp quyền phải là chủ repo, hoặc người có quyền với repo.
2. Bấm **New +** → **Blueprint**.
3. Chọn repo **`vucongtung2611-creator/Homeapp.`** và nhánh **`claude/loving-turing-nrtboc`**, hoặc `main` nếu đã gộp nhánh này vào.
4. Render đọc tệp `render.yaml` và hiện dịch vụ **mate** (gói **Free**). Ở ô **DATABASE_URL**, dán chuỗi kết nối Neon từ bước 1.
5. Bấm **Apply** / **Deploy Blueprint**. Lần build đầu mất khoảng 5–10 phút.
6. Khi trạng thái chuyển sang **Live**, link của app nằm ở đầu trang, dạng `https://mate-xxxx.onrender.com`.

### Bước 3 — Thử ngay

1. Mở link trên điện thoại → **Get started** → tạo tài khoản → tạo nhà.
2. Vào ⚙️ → **Create invite link** → gửi link cho một người bạn.
3. Cài như app: trên iPhone, mở bằng Safari → nút Chia sẻ → **Thêm vào MH chính**. Trên Android, mở bằng Chrome → ⋮ → **Cài đặt ứng dụng**.

### (Tuỳ chọn) Bước 4 — Giữ app không ngủ

App ngủ sau 15 phút không ai dùng; người mở đầu tiên sẽ chờ khoảng nửa phút. Nếu muốn tránh:

1. Vào **https://uptimerobot.com** → tạo tài khoản miễn phí.
2. **Add New Monitor** → loại **HTTP(s)** → URL `https://mate-xxxx.onrender.com/api/health` → mỗi **10 phút** (gói free tối thiểu 5 phút).

Một app chạy liên tục dùng khoảng 744 giờ/tháng, vẫn nằm trong 750 giờ miễn phí của Render. Chỉ nên có **một** dịch vụ Free trong tài khoản Render nếu bật bước này.

---

## Bảo mật cơ bản (đã có sẵn)

- **HTTPS:** Render tự cấp. App tự nhận biết HTTPS, bật cookie `Secure` và header HSTS.
- **Không có khoá bí mật trong code.** `DATABASE_URL` chỉ nằm trong cài đặt của Render. Kết nối tới Neon luôn qua TLS có kiểm tra chứng chỉ.
- **Mật khẩu** băm bằng scrypt. **Phiên đăng nhập** lưu dạng băm, cookie `HttpOnly`.
- **Giới hạn số lần đăng nhập:**
  - 10 lần / 15 phút cho mỗi cặp IP + email;
  - 50 lần / 15 phút cho mỗi IP;
  - giới hạn riêng cho đăng ký và link mời.
  - IP được lấy từ thông tin do proxy của Render ghi vào, nên người dùng không giả mạo được.
- **Dữ liệu mỗi nhà tách riêng:** kiểm tra thành viên ở mọi API, dữ liệu riêng tư chỉ người tạo thấy. Có test tự động cho từng điều này.
- **Lộ chuỗi kết nối?** Vào Neon → **Roles** → **Reset password**, rồi dán chuỗi mới vào Render (**Environment** → `DATABASE_URL` → **Save**). App tự khởi động lại.

## Phương án B — Koyeb

1. **https://www.koyeb.com** → đăng ký bằng GitHub.
2. **Create Service** → **GitHub** → chọn repo và nhánh như trên.
3. Builder: **Dockerfile**. Instance: **Free**. Region: Frankfurt. Exposed port: **3000**. Health check: HTTP `/api/health`.
4. **Environment variables:**
   - `DATABASE_URL`: chọn loại **Secret**, dán chuỗi Neon;
   - `TRUST_PROXY` = `1`;
   - `HOUSEHOLD_QUOTA_MB` = `50`.
5. **Deploy** → link dạng `https://mate-xxxx.koyeb.app`.

Các thông số này cũng được ghi lại trong `koyeb.yaml`.

## Chạy thử Postgres trên máy (không cần cài Postgres)

```bash
npm install && npm run build
node scripts/pg-dev.mjs                      # một Postgres tạm (PGlite) ở cổng 5433
DATABASE_URL=postgres://postgres@127.0.0.1:5433/postgres PG_POOL_MAX=1 npm start
```

Máy chủ PGlite thử nghiệm chỉ phục vụ ổn một kết nối mỗi lúc, nên cần `PG_POOL_MAX=1`. Với Neon thì để mặc định.
