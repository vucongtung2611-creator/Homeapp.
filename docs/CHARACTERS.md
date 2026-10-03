# Ảnh nhân vật — gắn ảnh gốc ở đâu

## Hiện trạng

Đã kiểm tra `src/characters.ts`, thư mục `web/public/characters/` và toàn bộ lịch sử git: **chưa có ảnh gốc nào** cho cả 5 nhân vật. Mỗi thư mục mới chỉ có `README.md`.

| Nhân vật | Ảnh gốc | Đang hiển thị |
|---|---|---|
| Tom (linh vật) | **chưa có** | Hình nét mực tạm, không màu riêng |
| James | **chưa có** | Hình nét mực tạm: kính tròn, râu, áo nâu, chữ **J** trên áo |
| Timothy | **chưa có** | Hình nét mực tạm: mũ nồi, áo xanh, chữ **T** |
| Ella | **chưa có** | Hình nét mực tạm: búi tóc, tóc dài, áo hồng đậm, chữ **E** |
| Nolan | **chưa có** | Hình nét mực tạm: mũ lưỡi trai, áo xanh lá, chữ **N** |

Hình tạm vẫn chớp mắt, vẫy tay và "thở" như ảnh thật sẽ làm. Hình tạm được vẽ trong `web/src/characters.tsx` (`TomSketch`, `CharacterSketch`).

## Cách gắn ảnh (không cần sửa code)

Đặt file vào đúng thư mục, dựng lại app (`npm run build`), rồi đẩy lên. Render tự cập nhật.

```
web/public/characters/
  tom/      avatar.webp  blink.webp  wave.webp  welcome.webp
            layers/hair/<tên>.webp   layers/outfit/<tên>.webp   (tóc, trang phục thay được — sau này)
  james/    avatar.webp  blink.webp  wave.webp  library.webp
  timothy/  avatar.webp  blink.webp  wave.webp  chat.webp
  ella/     avatar.webp  blink.webp  wave.webp  kitchen.webp  bills.webp
  nolan/    avatar.webp  blink.webp  wave.webp  chat.webp
```

| File | Bắt buộc? | Dùng để |
|---|---|---|
| `avatar.*` | **Có** — có file này là ảnh thật thay hình tạm | Nhân vật ở tư thế nghỉ |
| `blink.*` | Không | Cùng tư thế, mắt nhắm → nhân vật chớp mắt |
| `wave.*` | Không | Cùng tư thế, đang vẫy tay → dùng khi chào |
| `<phòng>.*` | Không | Nhân vật trong một phòng: `chat`, `library`, `bills`, `kitchen`, `wardrobe`, `welcome` |

**Yêu cầu ảnh:**
- Định dạng `.webp` (khuyên dùng), `.png`, `.jpg` hoặc `.svg`.
- Nền trong suốt; khung vuông (ví dụ 512 × 512).
- Mọi khung hình của cùng nhân vật thẳng hàng với nhau, để chớp mắt và vẫy tay không bị "nhảy".

Khi ảnh `avatar.*` của nhân vật nào có mặt, app tự dùng ảnh đó ở mọi nơi: chọn nhân vật, chat, thành viên, hộp thư. Các nhân vật khác vẫn dùng hình tạm.
