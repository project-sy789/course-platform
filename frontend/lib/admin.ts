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
    price_cents?: number;
    access_duration_days?: number | null;
    pixel_watermark?: boolean;
  }) =>
    apiFetch<{ id: string }>("/api/v1/admin/courses", {
      method: "POST", body: JSON.stringify(body),
    }),
  updateCourse: (slug: string, body: {
    title?: string;
    description?: string;
    price_cents?: number;
    access_duration_days?: number | null;
    pixel_watermark?: boolean;
  }) =>
    apiFetch<{ ok: boolean }>(`/api/v1/admin/courses/${slug}`, {
      method: "PATCH", body: JSON.stringify(body),
    }),
  deleteCourse: (slug: string) =>
    apiFetch<{ ok: boolean }>(`/api/v1/admin/courses/${slug}`, {
      method: "DELETE",
    }),
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
};
