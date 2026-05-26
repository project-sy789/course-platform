const API = process.env.NEXT_PUBLIC_API_BASE!;

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
