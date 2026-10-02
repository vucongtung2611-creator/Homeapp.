import { ApiError } from './api.js';

const ERRORS: Record<string, string> = {
  network: 'Không kết nối được. Kiểm tra mạng rồi thử lại.',
  server_error: 'Máy chủ gặp lỗi. Thử lại sau ít phút.',
  invalid_credentials: 'Email hoặc mật khẩu không đúng.',
  invalid_email: 'Email chưa đúng định dạng.',
  password_too_short: 'Mật khẩu cần ít nhất 8 ký tự.',
  password_too_long: 'Mật khẩu quá dài.',
  invalid_name: 'Hãy nhập tên của bạn.',
  email_taken: 'Email này đã có tài khoản. Hãy đăng nhập.',
  rate_limited: 'Bạn thao tác hơi nhanh. Đợi một chút rồi thử lại.',
  not_signed_in: 'Bạn cần đăng nhập.',
  not_found: 'Không tìm thấy, hoặc bạn không có quyền xem.',
  forbidden: 'Bạn không có quyền làm việc này.',
  owner_only: 'Chỉ chủ nhà làm được việc này.',
  owner_cannot_leave: 'Chủ nhà không thể rời nhà.',
  invite_invalid: 'Link mời đã hết hạn hoặc không còn dùng được. Hãy xin link mới.',
  household_full: 'Nhà đã đủ 20 người.',
  too_many_households: 'Bạn đã có quá nhiều nhà.',
  file_too_large: 'Tệp lớn hơn 10 MB.',
  unsupported_file_type: 'Chỉ nhận ảnh (JPG, PNG, WebP, GIF) hoặc PDF.',
  empty_file: 'Tệp trống.',
  upload_failed: 'Tải tệp lên không thành công.',
  attachment_invalid: 'Tệp đính kèm không hợp lệ.',
  amount_invalid: 'Số tiền chưa đúng.',
  description_required: 'Hãy nhập mô tả.',
  title_required: 'Hãy nhập tiêu đề.',
  name_required: 'Hãy đặt tên cho nhà.',
  period_invalid: 'Kỳ thanh toán: ngày bắt đầu phải trước ngày kết thúc.',
  responsible_invalid: 'Hãy chọn ít nhất một người để chia.',
  participants_invalid: 'Hãy chọn ít nhất một người để chia.',
  message_empty: 'Tin nhắn trống.',
  csrf: 'Yêu cầu bị chặn vì lý do bảo mật. Tải lại trang.',
  storage_full: 'Nhà đã dùng hết 500 MB lưu trữ. Xoá bớt tệp cũ rồi thử lại.',
  chat_images_only: 'Chat chỉ gửi được ảnh. Tài liệu hãy cất vào Thư viện.',
  body_too_large: 'Nội dung quá dài.',
};

export function errorText(err: unknown): string {
  if (err instanceof ApiError) return ERRORS[err.code] ?? `Có lỗi (${err.code}).`;
  if (err instanceof Error && ERRORS[err.message]) return ERRORS[err.message]!;
  return 'Có lỗi xảy ra. Thử lại nhé.';
}

export function money(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat('vi-VN', { style: 'currency', currency }).format(amount);
  } catch {
    return `${amount} ${currency}`;
  }
}

/** Show an amount in an input the way people type it (1.234.567 for VND). */
export function amountInput(amount: number | undefined, currency: string): string {
  if (amount === undefined) return '';
  const digits = currency === 'VND' || currency === 'JPY' || currency === 'KRW' ? 0 : 2;
  return new Intl.NumberFormat('vi-VN', { minimumFractionDigits: 0, maximumFractionDigits: digits }).format(amount);
}

export function viDate(iso?: string): string {
  if (!iso) return '';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}

export function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function daysUntil(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number);
  const target = new Date(y!, m! - 1, d!).getTime();
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return Math.round((target - today) / 86_400_000);
}

export function dueText(iso?: string): { text: string; tone: '' | 'warn' | 'danger' } {
  if (!iso) return { text: 'Không có hạn', tone: '' };
  const n = daysUntil(iso);
  if (n < 0) return { text: `Quá hạn ${-n} ngày`, tone: 'danger' };
  if (n === 0) return { text: 'Hạn hôm nay', tone: 'danger' };
  if (n === 1) return { text: 'Hạn ngày mai', tone: 'warn' };
  if (n <= 5) return { text: `Còn ${n} ngày`, tone: 'warn' };
  return { text: `Hạn ${viDate(iso)}`, tone: '' };
}

export function timeOf(iso: string): string {
  return new Date(iso).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
}

export function dayLabel(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (sameDay(d, now)) return 'Hôm nay';
  const y = new Date(now);
  y.setDate(now.getDate() - 1);
  if (sameDay(d, y)) return 'Hôm qua';
  return d.toLocaleDateString('vi-VN', { weekday: 'long', day: 'numeric', month: 'numeric' });
}

const AVATAR_COLORS = ['#0E7C66', '#2563EB', '#C2410C', '#7C3AED', '#BE185D', '#0369A1', '#4D7C0F', '#B45309'];
export function avatarColor(id: string): string {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length]!;
}
export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(-2)
    .map((w) => w[0]!.toUpperCase())
    .join('');

export const CATEGORY: Record<string, { label: string; emoji: string }> = {
  electricity: { label: 'Tiền điện', emoji: '⚡️' },
  water: { label: 'Tiền nước', emoji: '💧' },
  gas: { label: 'Tiền gas', emoji: '🔥' },
  internet: { label: 'Internet', emoji: '📶' },
  rent: { label: 'Tiền nhà', emoji: '🏠' },
  phone: { label: 'Điện thoại', emoji: '📱' },
  insurance: { label: 'Bảo hiểm', emoji: '🛡️' },
  other: { label: 'Khác', emoji: '🧾' },
};

export const ROLE: Record<string, string> = {
  owner: 'Chủ nhà',
  tenant: 'Ở chung',
  family_member: 'Thành viên',
  child: 'Con',
};
