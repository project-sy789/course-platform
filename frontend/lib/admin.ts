import { apiFetch } from "./api";

export type Stats = {
  users: number;
  courses: number;
  lessons: number;
  enrollments: number;
  key_grants_24h: number;
  key_denials_24h: number;
};

export type AdminUser = {
  id: string;
  email: string;
  is_admin: boolean;
  is_active: boolean;
  created_at: string;
};

export type LogRow = {
  id: number;
  user_id: string | null;
  video_id: string;
  ip: string;
  user_agent: string | null;
  granted: boolean;
  reason: string | null;
  created_at: string;
};

export const adminApi = {
  stats: () => apiFetch<Stats>("/api/v1/admin/stats"),
  users: () => apiFetch<AdminUser[]>("/api/v1/admin/users"),
  createCourse: (body: {
    slug: string;
    title: string;
    description?: string;
    price_baht?: number;
    access_duration_days?: number | null;
    pixel_watermark?: boolean;
  }) =>
    apiFetch<{ id: string }>("/api/v1/admin/courses", {
      method: "POST", body: JSON.stringify(body),
    }),
  updateCourse: (slug: string, body: {
    title?: string;
    description?: string;
    price_baht?: number;
    access_duration_days?: number | null;
    pixel_watermark?: boolean;
    is_featured?: boolean;
  }) =>
    apiFetch<{ ok: boolean }>(`/api/v1/admin/courses/${slug}`, {
      method: "PATCH", body: JSON.stringify(body),
    }),
  deleteCourse: (slug: string) =>
    apiFetch<{ ok: boolean }>(`/api/v1/admin/courses/${slug}`, {
      method: "DELETE",
    }),
  uploadCourseCover: async (slug: string, file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch(
      `${process.env.NEXT_PUBLIC_API_BASE ?? ""}/api/v1/admin/courses/${slug}/cover`,
      { method: "POST", credentials: "include", body: fd },
    );
    if (!res.ok) {
      let detail = `${res.status}`;
      try { detail = (await res.json()).detail ?? detail; } catch { /* ignore */ }
      throw new Error(`อัปโหลดปกไม่สำเร็จ: ${detail}`);
    }
    return res.json() as Promise<{ cover_url: string }>;
  },
  deleteCourseCover: (slug: string) =>
    apiFetch<{ ok: boolean }>(`/api/v1/admin/courses/${slug}/cover`, {
      method: "DELETE",
    }),
  updateLesson: (lessonId: string, body: {
    title?: string;
    position?: number;
    is_preview?: boolean;
    price_baht?: number;
  }) =>
    apiFetch<{ ok: boolean }>(`/api/v1/admin/lessons/${lessonId}`, {
      method: "PATCH", body: JSON.stringify(body),
    }),
  deleteLesson: (lessonId: string) =>
    apiFetch<{ ok: boolean }>(`/api/v1/admin/lessons/${lessonId}`, {
      method: "DELETE",
    }),
  listMaterials: (lessonId: string) =>
    apiFetch<{ id: string; filename: string; content_type: string; size_bytes: number; created_at: string }[]>(
      `/api/v1/admin/lessons/${lessonId}/materials`,
    ),
  uploadMaterial: async (lessonId: string, file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch(
      `${process.env.NEXT_PUBLIC_API_BASE ?? ""}/api/v1/admin/lessons/${lessonId}/materials`,
      { method: "POST", credentials: "include", body: fd },
    );
    if (!res.ok) {
      let detail = `${res.status}`;
      try { detail = (await res.json()).detail ?? detail; } catch { /* ignore */ }
      throw new Error(`อัปโหลด ${file.name} ไม่สำเร็จ: ${detail}`);
    }
    return res.json() as Promise<{ id: string; filename: string; size_bytes: number; content_type: string }>;
  },
  deleteMaterial: (materialId: string) =>
    apiFetch<{ ok: boolean }>(`/api/v1/admin/materials/${materialId}`, {
      method: "DELETE",
    }),
  listCourseMaterials: (slug: string) =>
    apiFetch<{ id: string; filename: string; content_type: string; size_bytes: number; created_at: string }[]>(
      `/api/v1/admin/courses/${slug}/materials`,
    ),
  uploadCourseMaterial: async (slug: string, file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch(
      `${process.env.NEXT_PUBLIC_API_BASE ?? ""}/api/v1/admin/courses/${slug}/materials`,
      { method: "POST", credentials: "include", body: fd },
    );
    if (!res.ok) {
      let detail = `${res.status}`;
      try { detail = (await res.json()).detail ?? detail; } catch { /* ignore */ }
      throw new Error(`อัปโหลด ${file.name} ไม่สำเร็จ: ${detail}`);
    }
    return res.json() as Promise<{ id: string; filename: string; size_bytes: number; content_type: string }>;
  },
  grantEnrollment: (user_email: string, course_slug: string) =>
    apiFetch<{ id: string; status: string }>("/api/v1/admin/enrollments", {
      method: "POST", body: JSON.stringify({ user_email, course_slug }),
    }),
  logs: (params: { granted?: boolean; user_id?: string; video_id?: string; limit?: number } = {}) => {
    const q = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => v !== undefined && q.set(k, String(v)));
    return apiFetch<LogRow[]>(`/api/v1/admin/logs?${q.toString()}`);
  },
  createUpload: () =>
    apiFetch<{ upload_id: string }>("/api/v1/admin/uploads", { method: "POST" }),
  uploadFile: async (uploadId: string, file: File, relpath: string = "") => {
    const fd = new FormData();
    fd.append("filename", file.name);
    fd.append("relpath", relpath);
    fd.append("file", file);
    const res = await fetch(
      `${process.env.NEXT_PUBLIC_API_BASE}/api/v1/admin/uploads/${uploadId}/file`,
      { method: "POST", credentials: "include", body: fd },
    );
    if (!res.ok) throw new Error(`upload ${relpath ? relpath + "/" : ""}${file.name} failed: ${res.status}`);
    return res.json() as Promise<{ ok: boolean; size: number }>;
  },
  finalize: (body: {
    upload_id: string;
    course_slug: string;
    lesson_title: string;
    lesson_position: number;
    aes_key_hex: string;
    manifest_filename?: string;
    is_preview?: boolean;
    duration_sec?: number;
  }) =>
    apiFetch<{ video_id: string; lesson_id: string; manifest_url: string }>(
      "/api/v1/admin/uploads/finalize",
      { method: "POST", body: JSON.stringify(body) },
    ),
  enqueueEncode: (body: {
    upload_id: string;
    course_slug: string;
    lesson_title: string;
    lesson_position?: number;
    is_preview?: boolean;
  }) =>
    apiFetch<{ job_id: string; status: string }>(
      "/api/v1/admin/encode-jobs",
      { method: "POST", body: JSON.stringify(body) },
    ),
  listEncodeJobs: (limit = 20) =>
    apiFetch<{
      id: string;
      upload_id: string;
      course_slug: string;
      lesson_title: string;
      status: string;
      error: string | null;
      video_id: string | null;
      created_at: string;
    }[]>(`/api/v1/admin/encode-jobs?limit=${limit}`),
  getPaymentSettings: () =>
    apiFetch<{
      receiver_bank_name: string;
      receiver_bank_account: string;
      receiver_name: string;
      promptpay_id: string;
      slipok_branch_id: string;
      slipok_api_key_set: boolean;
      slipok_enabled: boolean;
      receiver_bank_set: boolean;
      overrides: {
        receiver_bank_name: boolean;
        receiver_bank_account: boolean;
        receiver_name: boolean;
        promptpay_id: boolean;
        slipok_branch_id: boolean;
        slipok_api_key: boolean;
      };
    }>("/api/v1/admin/payment-settings"),
  updatePaymentSettings: (body: {
    receiver_bank_name?: string;
    receiver_bank_account?: string;
    receiver_name?: string;
    promptpay_id?: string;
    slipok_branch_id?: string;
    slipok_api_key?: string;        // empty string = leave key unchanged
    clear_slipok_api_key?: boolean; // true = wipe key
  }) =>
    apiFetch<{ ok: boolean }>("/api/v1/admin/payment-settings", {
      method: "PUT", body: JSON.stringify(body),
    }),

  // ---------- Email-provider settings ----------
  getEmailSettings: () =>
    apiFetch<EmailSettingsView>("/api/v1/admin/email-settings"),
  updateEmailSettings: (body: {
    provider?: EmailProvider;
    api_key?: string;        // empty string = leave key unchanged
    from_email?: string;
    from_name?: string;
    clear_api_key?: boolean; // true = wipe key
  }) =>
    apiFetch<{ ok: boolean }>("/api/v1/admin/email-settings", {
      method: "PUT", body: JSON.stringify(body),
    }),
  sendTestEmail: (to: string) =>
    apiFetch<{ ok: boolean }>("/api/v1/admin/settings/test-email", {
      method: "POST", body: JSON.stringify({ to }),
    }),

  // ---------- Coupons ----------
  listCoupons: (activeOnly = false) =>
    apiFetch<Coupon[]>(
      `/api/v1/admin/coupons${activeOnly ? "?active_only=true" : ""}`,
    ),
  createCoupon: (body: CouponInput) =>
    apiFetch<Coupon>("/api/v1/admin/coupons", {
      method: "POST", body: JSON.stringify(body),
    }),
  updateCoupon: (id: string, body: Partial<CouponInput>) =>
    apiFetch<Coupon>(`/api/v1/admin/coupons/${id}`, {
      method: "PATCH", body: JSON.stringify(body),
    }),
  deactivateCoupon: (id: string) =>
    apiFetch<{ ok: boolean }>(`/api/v1/admin/coupons/${id}`, { method: "DELETE" }),
  couponRedemptions: (id: string) =>
    apiFetch<CouponRedemption[]>(`/api/v1/admin/coupons/${id}/redemptions`),

  // ---------- Dashboard ----------
  dashboard: () => apiFetch<Dashboard>("/api/v1/admin/dashboard"),

  // ---------- User management (new) ----------
  userSearch: (params: {
    q?: string;
    role?: "admin" | "user";
    status_filter?: "active" | "suspended" | "unverified";
    sort?: "created_desc" | "created_asc" | "email_asc";
    limit?: number;
    offset?: number;
  } = {}) => {
    const qs = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => v !== undefined && v !== "" && qs.set(k, String(v)));
    return apiFetch<UserSearchResult>(`/api/v1/admin/users/search?${qs.toString()}`);
  },
  userDetail: (id: string) =>
    apiFetch<AdminUserDetail>(`/api/v1/admin/users/${id}`),
  patchUser: (id: string, body: { is_active?: boolean; is_admin?: boolean }) =>
    apiFetch<{ ok: boolean; noop?: boolean; user?: AdminUser }>(
      `/api/v1/admin/users/${id}`,
      { method: "PATCH", body: JSON.stringify(body) },
    ),
  revokeDevices: (id: string) =>
    apiFetch<{ ok: boolean; revoked: number }>(
      `/api/v1/admin/users/${id}/revoke-devices`, { method: "POST" },
    ),
  resetPassword: (id: string) =>
    apiFetch<{ ok: boolean; reset_url: string; ttl_minutes: number }>(
      `/api/v1/admin/users/${id}/reset-password`, { method: "POST" },
    ),
  deleteUser: (id: string) =>
    apiFetch<{ ok: boolean }>(`/api/v1/admin/users/${id}`, { method: "DELETE" }),
  bulkUsers: (body: {
    user_ids: string[];
    action: "suspend" | "activate" | "promote" | "demote" | "delete";
  }) =>
    apiFetch<{ ok: boolean; affected: number }>("/api/v1/admin/users/bulk", {
      method: "POST", body: JSON.stringify(body),
    }),

  // ---------- Audit log ----------
  listAudit: (params: { actor_email?: string; action?: string; limit?: number; offset?: number } = {}) => {
    const qs = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => v !== undefined && v !== "" && qs.set(k, String(v)));
    return apiFetch<{ total: number; rows: AuditRow[] }>(`/api/v1/admin/audit?${qs.toString()}`);
  },

  // ---------- Email broadcast ----------
  emailBroadcast: (body: {
    audience: "all" | "active" | "admins" | "enrolled";
    subject: string;
    body: string;
    course_slug?: string;
    dry_run?: boolean;
  }) =>
    apiFetch<{ recipient_count: number; dry_run: boolean; queued?: boolean }>(
      "/api/v1/admin/email-broadcast",
      { method: "POST", body: JSON.stringify(body) },
    ),

  // ---------- Video health ----------
  videoHealth: () => apiFetch<VideoHealth>("/api/v1/admin/video-health"),

  // ---------- CSV exports (URLs for <a download>) ----------
  usersCsvUrl: () => `${process.env.NEXT_PUBLIC_API_BASE ?? ""}/api/v1/admin/users.csv`,
  paymentsCsvUrl: () => `${process.env.NEXT_PUBLIC_API_BASE ?? ""}/api/v1/admin/payments.csv`,
};

// ---------- Types: dashboard / user mgmt / audit ----------

export type VideoHealth = {
  generated_at: string;
  encode: {
    last_24h: { pending: number; running: number; done: number; failed: number };
    recent_failed: {
      id: string; course_slug: string; lesson_title: string;
      error: string; created_at: string; updated_at: string;
    }[];
    recent_done: {
      id: string; course_slug: string; lesson_title: string;
      created_at: string; updated_at: string; duration_sec: number;
    }[];
    sparkline_24h: ({
      hour: string; pending: number; running: number; done: number; failed: number;
    })[];
  };
  playback: {
    grants_24h: number;
    denies_24h: number;
    deny_reasons: { reason: string; count: number }[];
    sparkline_24h: { hour: string; granted: number; denied: number }[];
  };
  suspicious: {
    multi_user_ips: { ip: string | null; user_count: number; request_count: number }[];
    multi_ip_users: { user_id: string; email: string; ip_count: number; request_count: number }[];
    thresholds: { users_per_ip: number; ips_per_user: number };
  };
  storage: {
    reachable: boolean;
    latency_ms: number;
    error: string | null;
    bucket: string | null;
  };
  sessions: {
    total_active: number;
    max_per_user: number;
    near_max: { user_id: string; count: number }[];
  };
  videos: { total: number; encoded_today: number };
};

export type EmailProvider = "smtp" | "resend" | "postmark" | "sendgrid" | "disabled";

export type EmailSettingsView = {
  provider: EmailProvider;
  api_key_set: boolean;
  from_email: string;
  from_name: string;
  configured: boolean;
  smtp: {
    host: string;
    port: number;
    use_tls: boolean;
    user: string | null;
    password_set: boolean;
  };
  overrides: {
    provider: boolean;
    api_key: boolean;
    from_email: boolean;
    from_name: boolean;
  };
};

export type Dashboard = {
  revenue: { today_baht: number; month_baht: number; total_baht: number };
  pending_slips: number;
  new_users_7d: number;
  coupons_today: number;
  suspicious_logins_24h: number;
  top_courses: { slug: string; title: string; sold: number; revenue_baht: number }[];
  sparkline_30d: { date: string; revenue_baht: number }[];
};

export type UserBrief = {
  id: string;
  email: string;
  is_admin: boolean;
  is_active: boolean;
  email_verified: boolean;
  created_at: string;
};

export type UserSearchResult = {
  total: number;
  rows: UserBrief[];
};

export type AdminUserDetail = {
  user: UserBrief & { tax_name: string | null; tax_id: string | null };
  enrollments: {
    id: string; course_slug: string; course_title: string;
    expires_at: string | null; created_at: string;
  }[];
  payments: {
    id: string; amount_baht: number; status: string;
    invoice_number: string | null; created_at: string;
  }[];
  devices: {
    id: string; label: string | null;
    last_seen_at: string | null; last_ip: string | null;
  }[];
  logins: {
    id: string; status: string; suspicious: boolean;
    ip: string | null; created_at: string;
  }[];
  slips: {
    id: string; status: string; amount_baht: number; created_at: string;
  }[];
};

export type AuditRow = {
  id: string;
  actor_email: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  summary: string;
  detail: string | null;
  ip: string | null;
  created_at: string;
};

export type CouponKind = "fixed" | "percent" | "full";
export type CouponScope = "all" | "course" | "lesson";

export type Coupon = {
  id: string;
  code: string;
  kind: CouponKind;
  amount_baht: number | null;
  percent: number | null;
  max_discount_baht: number | null;
  min_purchase_baht: number;
  scope: CouponScope;
  target_course_id: string | null;
  target_course_slug: string | null;
  target_lesson_id: string | null;
  target_lesson_title: string | null;
  valid_from: string | null;
  valid_until: string | null;
  usage_limit: number | null;
  per_user_limit: number | null;
  usage_count: number;
  is_active: boolean;
  note: string | null;
  created_at: string | null;
};

export type CouponInput = {
  code: string;
  kind: CouponKind;
  amount_baht?: number | null;
  percent?: number | null;
  max_discount_baht?: number | null;
  min_purchase_baht?: number;
  scope: CouponScope;
  target_course_slug?: string | null;
  target_lesson_id?: string | null;
  valid_from?: string | null;
  valid_until?: string | null;
  usage_limit?: number | null;
  per_user_limit?: number | null;
  is_active?: boolean;
  note?: string | null;
};

export type CouponRedemption = {
  id: string;
  user_id: string;
  user_email: string | null;
  payment_id: string | null;
  slip_upload_id: string | null;
  original_baht: number;
  discount_baht: number;
  final_baht: number;
  redeemed_at: string;
};

export type CouponQuote =
  | {
      valid: true;
      code: string;
      original_baht: number;
      discount_baht: number;
      final_baht: number;
    }
  | { valid: false; reason: string };

export const couponApi = {
  validate: (body: { code: string; course_slug?: string; lesson_id?: string }) =>
    apiFetch<CouponQuote>("/api/v1/coupons/validate", {
      method: "POST", body: JSON.stringify(body),
    }),
};
