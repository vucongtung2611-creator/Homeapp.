import type { HomeApp } from '../src/index.js';

/** Sample content so a brand-new home isn't empty. Every piece is marked `sample` and can be cleared in one tap. */
export function seedSamples(app: HomeApp, householdId: string, ownerId: string, now: Date): { welcome: string } {
  const currency = String(app.platform.graph.requireNode(householdId).props.currency ?? 'VND');
  const vnd = currency === 'VND';
  const iso = (days: number) => new Date(now.getTime() + days * 86_400_000).toISOString().slice(0, 10);

  app.items.create(ownerId, householdId, {
    kind: 'note',
    title: 'Wi-Fi nhà mình',
    body: 'Tên mạng: NhaMinh_5G\nMật khẩu: (sửa ghi chú này để điền mật khẩu thật)',
    tags: ['nhà', 'wifi'],
    sample: true,
  });
  app.items.create(ownerId, householdId, {
    kind: 'note',
    title: 'Nội quy chung',
    body: '• Đổ rác tối thứ Ba và thứ Sáu\n• Ai nấu thì người kia rửa bát\n• Khách ở qua đêm thì báo trước trong chat',
    tags: ['nhà', 'nội quy'],
    sample: true,
  });
  app.items.create(ownerId, householdId, {
    kind: 'note',
    title: 'Số điện thoại cần thiết',
    body: 'Chủ nhà: 09xx xxx xxx\nThợ sửa ống nước: 09xx xxx xxx\nBảo vệ toà nhà: 09xx xxx xxx',
    tags: ['liên hệ'],
    sample: true,
  });
  app.items.create(ownerId, householdId, {
    kind: 'note',
    title: 'Ghi chú riêng của bạn',
    body: 'Ghi chú có ổ khoá chỉ mình bạn thấy. Người ở chung không xem được.',
    tags: ['riêng tư'],
    private: true,
    sample: true,
  });

  const bill = app.finance.recordBill(ownerId, householdId, {
    category: 'electricity',
    label: 'Tiền điện (mẫu)',
    amount: vnd ? 850_000 : 142.5,
    provider: vnd ? 'EVN' : 'Energy Co',
    dueDate: iso(5),
    periodStart: iso(-35),
    periodEnd: iso(-5),
  });
  app.platform.graph.updateNode(bill.id, { sample: true });

  return {
    welcome:
      'Chào mừng về nhà! 👋 Đây là chat chung của cả nhà. Thư viện có vài ghi chú mẫu, và tab Hóa đơn có một hóa đơn mẫu để bạn thử chia tiền. ' +
      'Vào ⚙️ để mời người ở chung hoặc xoá dữ liệu mẫu.',
  };
}

export function clearSamples(app: HomeApp, householdId: string): number {
  const graph = app.platform.graph;
  const samples = graph.find((n) => n.householdId === householdId && n.props.sample === true);
  for (const node of samples) {
    for (const task of graph.neighbors(node.id, { relation: 'about', direction: 'in', type: 'task' })) graph.removeNode(task.id);
    graph.removeNode(node.id);
  }
  return samples.length;
}

export function hasSamples(app: HomeApp, householdId: string): boolean {
  return app.platform.graph.find((n) => n.householdId === householdId && n.props.sample === true).length > 0;
}
