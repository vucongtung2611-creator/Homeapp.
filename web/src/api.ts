export class ApiError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
  ) {
    super(code);
  }
}

/** Every call carries the CSRF header the server requires. */
export async function api<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: {
        'X-Requested-With': 'homeapp',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError('network', 0);
  }
  const data = res.headers.get('content-type')?.includes('json') ? await res.json().catch(() => ({})) : {};
  if (!res.ok) throw new ApiError((data as { error?: string }).error ?? 'server_error', res.status);
  return data as T;
}

/** Upload raw bytes; resolves with the stored file, reports progress 0..1. */
export function upload(
  householdId: string,
  blob: Blob,
  name: string,
  onProgress?: (p: number) => void,
): Promise<UploadedFile> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/households/${householdId}/files`);
    xhr.setRequestHeader('X-Requested-With', 'homeapp');
    xhr.setRequestHeader('X-File-Name', encodeURIComponent(name));
    xhr.setRequestHeader('Content-Type', blob.type || 'application/octet-stream');
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
    xhr.onload = () => {
      let data: any = {};
      try {
        data = JSON.parse(xhr.responseText);
      } catch {}
      if (xhr.status >= 200 && xhr.status < 300) resolve(data);
      else reject(new ApiError(data.error ?? 'upload_failed', xhr.status));
    };
    xhr.onerror = () => reject(new ApiError('network', 0));
    xhr.send(blob);
  });
}

export interface UploadedFile {
  id: string;
  name: string;
  mime: string;
  size: number;
  url: string;
}

export interface User {
  id: string;
  email: string;
  name: string;
  avatar: string;
}

export interface Member {
  id: string;
  name: string;
  role: string;
  avatar: string;
}

export interface Household {
  id: string;
  name: string;
  currency: string;
  kind: string;
  me: { id: string; role: string };
  members: Member[];
  hasSamples: boolean;
  canInvite: boolean;
  /** Whether the short code only asks to join (the owner approves). */
  approveJoins: boolean;
  /** Join requests waiting for the owner (0 for everyone else). */
  pendingRequests: number;
  /** The owner may delete the home: they're alone and nothing real is in it. */
  canDelete: boolean;
  /** Inbox entries this person hasn't seen yet. */
  unreadInbox: number;
}

export interface InviteLink {
  id: string;
  label: string;
  role: string;
  status: 'pending' | 'used' | 'expired' | 'revoked';
  /** For a used link: whether that person got in. */
  outcome: 'accepted' | 'waiting' | 'declined' | 'left' | null;
  createdAt: string;
  expiresAt: string;
  invitedBy: string;
  usedBy: string | null;
  usedAt: string | null;
  /** Only while it can still be used. */
  url: string | null;
}

export interface Invites {
  code: { code: string; expiresAt: string } | null;
  links: InviteLink[];
  roles: string[];
  approveJoins: boolean;
}

export interface JoinRequest {
  id: string;
  householdName: string;
  /** Set once approved, to go straight in. */
  householdId?: string;
  status: 'pending' | 'approved' | 'declined';
  createdAt: string;
}

export interface Message {
  id: string;
  seq: number;
  userId: string | null;
  userName: string | null;
  text: string;
  /** Language-neutral system message, rendered with t('system.<key>'). */
  system: { key: string; params?: Record<string, string | number> } | null;
  file: UploadedFile | null;
  createdAt: string;
}

export interface Item {
  id: string;
  kind: 'note' | 'document' | 'photo' | 'link';
  title: string;
  body: string;
  tags: string[];
  attachments: (UploadedFile & { fileId: string })[];
  private: boolean;
  ownerId: string;
  ownerName: string;
  createdAt: string;
  updatedAt: string;
  canEdit: boolean;
  canDelete: boolean;
  canChangePrivacy: boolean;
  sample: boolean;
}

export interface Bill {
  id: string;
  label: string;
  category: string;
  amount: number;
  currency: string;
  provider?: string;
  dueDate?: string;
  periodStart?: string;
  periodEnd?: string;
  shared: boolean;
  shares: Record<string, number>;
  status: 'unpaid' | 'paid';
  payerId?: string;
  paidAt?: string;
  ownerId: string;
  canDelete: boolean;
  sample: boolean;
}

export interface Expense {
  id: string;
  label: string;
  kind: 'expense' | 'settlement';
  amount: number;
  category: string;
  date: string;
  paidBy: string;
  participants: string[];
  shared: boolean;
  ownerId: string;
  canDelete: boolean;
  /** Inbox entries this person hasn't seen yet. */
  unreadInbox: number;
}

export interface Money {
  currency: string;
  members: Member[];
  bills: Bill[];
  expenses: Expense[];
  balances: Record<string, number>;
  transfers: { from: string; to: string; amount: number }[];
  reminders: { key: string; kind: string; amount: number; billId?: string; label?: string; dueDate?: string; to?: string }[];
}
