const API = process.env.NEXT_PUBLIC_API_BASE!;

/**
 * Per-browser device ID, lazily created on first use and persisted in
 * localStorage. Sent as `X-Device-Id` on every API call so the backend's
 * anti-account-sharing layer can recognise the browser and only challenge
 * with an emailed OTP on first sight (or after an impossible-travel jump).
 *
 * Clearing localStorage drops trust on purpose — next login from this
 * browser will trigger an OTP. That's the intended UX, not a bug.
 */
function getDeviceId(): string {
  if (typeof window === "undefined") return "";
  const KEY = "course-platform.device-id";
  let id = window.localStorage.getItem(KEY);
  if (!id) {
    id = (crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`);
    window.localStorage.setItem(KEY, id);
  }
  return id;
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      "X-Device-Id": getDeviceId(),
      ...(init.headers || {}),
    },
  });
  if (!res.ok) {
    let detail = "";
    try { detail = (await res.json())?.detail ?? ""; } catch { /* ignore */ }
    throw new ApiError(res.status, detail || `HTTP ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

/**
 * Login can return 202 + { otp_required, challenge_token } when the user is
 * coming from a new device or an unfamiliar IP region. Caller branches on
 * `otp_required` and renders the code input.
 */
export type LoginResult =
  | { otp_required: false; ok: true; token: string }
  | { otp_required: true; challenge_token: string };

export async function loginRequest(email: string, password: string): Promise<LoginResult> {
  const res = await fetch(`${API}/api/v1/auth/login`, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      "X-Device-Id": getDeviceId(),
    },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    let detail = "";
    try { detail = (await res.json())?.detail ?? ""; } catch { /* ignore */ }
    throw new ApiError(res.status, detail || `HTTP ${res.status}`);
  }
  const body = await res.json();
  if (body.otp_required) {
    return { otp_required: true, challenge_token: body.challenge_token };
  }
  return { otp_required: false, ok: true, token: body.token };
}

export function confirmDeviceOtp(challenge_token: string, code: string) {
  return apiFetch<{ ok: true; token: string }>(
    "/api/v1/auth/device-otp/confirm",
    { method: "POST", body: JSON.stringify({ challenge_token, code }) },
  );
}

export type PlaybackSession = {
  manifest_url: string;
  key_url_template: string;
  expires_in: number;
};

export function createPlaybackSession(videoId: string) {
  return apiFetch<PlaybackSession>(
    `/api/v1/videos/${videoId}/playback-session`,
    { method: "POST" },
  );
}

export type Device = {
  id: string;
  label: string;
  last_seen_at: string;
  last_ip: string | null;
  created_at: string;
  current: boolean;
};

export function listDevices() {
  return apiFetch<Device[]>("/api/v1/account/devices");
}

export function revokeDevice(id: string) {
  return apiFetch<{ ok: true }>(`/api/v1/account/devices/${id}`, {
    method: "DELETE",
  });
}

export function revokeAllDevices() {
  return apiFetch<{ ok: true }>("/api/v1/account/devices/revoke-all", {
    method: "POST",
  });
}

export type SlipInfo = {
  bank_name: string;
  account_number: string;
  account_name: string;
  promptpay_id: string;
  auto_verify: boolean;
};

export function getSlipInfo() {
  return apiFetch<SlipInfo>("/api/v1/slip-payments/info");
}

export type SlipUploadResult = {
  status: "auto_approved" | "pending";
  message: string;
  slip_id: string;
};

export async function uploadSlip(opts: {
  image: File;
  course_slug?: string;
  lesson_id?: string;
  coupon_code?: string;
}): Promise<SlipUploadResult> {
  const form = new FormData();
  form.append("image", opts.image);
  if (opts.course_slug) form.append("course_slug", opts.course_slug);
  if (opts.lesson_id) form.append("lesson_id", opts.lesson_id);
  if (opts.coupon_code) form.append("coupon_code", opts.coupon_code);
  const res = await fetch(`${API}/api/v1/slip-payments/upload`, {
    method: "POST",
    credentials: "include",
    headers: { "X-Device-Id": getDeviceId() },
    body: form,
  });
  if (!res.ok) {
    let detail = "";
    try { detail = (await res.json())?.detail ?? ""; } catch { /* ignore */ }
    throw new ApiError(res.status, detail || `HTTP ${res.status}`);
  }
  return res.json();
}

export type CartItem = { course_id?: string; lesson_id?: string };

export type OrderQuoteLine = {
  course_id: string | null;
  lesson_id: string | null;
  title: string;
  unit_price_baht: number;
  line_discount_baht: number;
  line_final_baht: number;
};

export type OrderQuote = {
  lines: OrderQuoteLine[];
  subtotal_baht: number;
  discount_baht: number;
  final_baht: number;
  coupon: { code: string; discount_baht: number } | null;
  coupon_reason: string | null;
};

export function quoteOrder(items: CartItem[], code?: string) {
  return apiFetch<OrderQuote>("/api/v1/orders/quote", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ items, code: code ?? null }),
  });
}

export type OrderUploadResult = SlipUploadResult & { order_id: string };

export async function uploadSlipOrder(opts: {
  items: CartItem[];
  image?: File | null;
  coupon_code?: string;
}): Promise<OrderUploadResult> {
  const form = new FormData();
  form.append("items_json", JSON.stringify(opts.items));
  if (opts.coupon_code) form.append("coupon_code", opts.coupon_code);
  if (opts.image) form.append("image", opts.image);
  const res = await fetch(`${API}/api/v1/slip-payments/upload-order`, {
    method: "POST",
    credentials: "include",
    headers: { "X-Device-Id": getDeviceId() },
    body: form,
  });
  if (!res.ok) {
    let detail = "";
    try { detail = (await res.json())?.detail ?? ""; } catch { /* ignore */ }
    throw new ApiError(res.status, detail || `HTTP ${res.status}`);
  }
  return res.json();
}
