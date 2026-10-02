/**
 * Sample content for a brand-new home, in the creator's language. Once
 * created it is the household's own content (and no longer translated).
 * Add a language by adding an entry; anything else falls back to English.
 */
export interface SampleContent {
  notes: { title: string; body: string; tags: string[]; private?: boolean }[];
  bill: { label: string; provider: { default: string; VND: string } };
}

export const SAMPLES: Record<string, SampleContent> = {
  en: {
    notes: [
      { title: 'Home Wi-Fi', body: 'Network: OurHome_5G\nPassword: (edit this note to add the real one)', tags: ['home', 'wifi'] },
      {
        title: 'House rules',
        body: '• Bins out on Tuesday and Friday nights\n• Whoever cooks doesn’t wash up\n• Overnight guests? Give everyone a heads-up in the chat',
        tags: ['home', 'rules'],
      },
      { title: 'Useful numbers', body: 'Landlord: …\nPlumber: …\nBuilding manager: …', tags: ['contacts'] },
      {
        title: 'Your private note',
        body: 'Notes with a lock are only visible to you. Your housemates can’t see them.',
        tags: ['private'],
        private: true,
      },
    ],
    bill: { label: 'Electricity', provider: { default: 'Energy Co', VND: 'EVN' } },
  },
  vi: {
    notes: [
      { title: 'Wi-Fi nhà mình', body: 'Tên mạng: NhaMinh_5G\nMật khẩu: (sửa ghi chú này để điền mật khẩu thật)', tags: ['nhà', 'wifi'] },
      {
        title: 'Nội quy chung',
        body: '• Đổ rác tối thứ Ba và thứ Sáu\n• Ai nấu thì người kia rửa bát\n• Khách ở qua đêm thì báo trước trong chat',
        tags: ['nhà', 'nội quy'],
      },
      { title: 'Số điện thoại cần thiết', body: 'Chủ nhà: …\nThợ sửa ống nước: …\nBảo vệ toà nhà: …', tags: ['liên hệ'] },
      {
        title: 'Ghi chú riêng của bạn',
        body: 'Ghi chú có ổ khoá chỉ mình bạn thấy. Người ở chung không xem được.',
        tags: ['riêng tư'],
        private: true,
      },
    ],
    bill: { label: 'Tiền điện', provider: { default: 'Energy Co', VND: 'EVN' } },
  },
};

export const samplesFor = (locale: string): SampleContent => SAMPLES[locale.toLowerCase().split('-')[0]!] ?? SAMPLES.en!;
