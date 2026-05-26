"use client";
import { useState } from "react";
import { adminApi } from "@/lib/admin";

type Phase = "idle" | "uploading" | "finalizing" | "done";

export default function AdminUploadPage() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [result, setResult] = useState<{ video_id: string; manifest_url: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState({
    courseSlug: "",
    lessonTitle: "",
    lessonPosition: 1,
    aesKeyHex: "",
    manifestFilename: "index.m3u8",
    isPreview: false,
  });
  const [files, setFiles] = useState<FileList | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null); setResult(null);
    if (!files || files.length === 0) { setError("Select HLS files"); return; }
    if (!/^[0-9a-fA-F]{32}$/.test(form.aesKeyHex)) {
      setError("AES key must be 32 hex chars (16 bytes)"); return;
    }
    if (![...files].some((f) => f.name === form.manifestFilename)) {
      setError(`Manifest file "${form.manifestFilename}" not in selection`); return;
    }

    try {
      const { upload_id } = await adminApi.createUpload();

      setPhase("uploading");
      setProgress({ done: 0, total: files.length });
      const arr = Array.from(files);
      for (let i = 0; i < arr.length; i++) {
        await adminApi.uploadFile(upload_id, arr[i]);
        setProgress({ done: i + 1, total: arr.length });
      }

      setPhase("finalizing");
      const fin = await adminApi.finalize({
        upload_id,
        course_slug: form.courseSlug,
        lesson_title: form.lessonTitle,
        lesson_position: Number(form.lessonPosition),
        aes_key_hex: form.aesKeyHex.toLowerCase(),
        manifest_filename: form.manifestFilename,
        is_preview: form.isPreview,
      });
      setResult({ video_id: fin.video_id, manifest_url: fin.manifest_url });
      setPhase("done");
    } catch (e: any) {
      setError(e.message);
      setPhase("idle");
    }
  }

  return (
    <div className="max-w-3xl">
      <h1 className="text-xl font-semibold mb-6">Upload video</h1>

      <div className="rounded-xl border border-neutral-800 p-4 mb-6 text-sm space-y-2">
        <p className="font-medium">Encode flow (do this locally before upload)</p>
        <pre className="bg-neutral-900 p-3 rounded overflow-x-auto text-xs">{`# 1. Generate a 16-byte AES key
KEY_HEX=$(openssl rand -hex 16)
echo -n "$KEY_HEX" | xxd -r -p > video.key

# 2. Build key_info.txt — the URI here is overridden by hls.js loader at playback,
#    but Safari (native HLS) reads it verbatim, so point it at your real backend:
cat > key_info.txt <<EOF
https://api.example.com/api/v1/videos/PLACEHOLDER/key
$(pwd)/video.key
EOF

# 3. Encode HLS with AES-128 segment encryption
ffmpeg -i source.mp4 \\
  -hls_time 6 -hls_key_info_file key_info.txt -hls_playlist_type vod \\
  -hls_segment_filename 'seg_%03d.ts' index.m3u8

# 4. Upload index.m3u8 + every seg_*.ts here. Paste $KEY_HEX into the form below.`}</pre>
      </div>

      <form onSubmit={submit} className="rounded-xl border border-neutral-800 p-4 grid gap-3">
        <input
          required placeholder="course slug" value={form.courseSlug}
          onChange={(e) => setForm({ ...form, courseSlug: e.target.value })}
          className="rounded bg-neutral-900 border border-neutral-700 px-3 py-2"
        />
        <input
          required placeholder="lesson title" value={form.lessonTitle}
          onChange={(e) => setForm({ ...form, lessonTitle: e.target.value })}
          className="rounded bg-neutral-900 border border-neutral-700 px-3 py-2"
        />
        <div className="grid grid-cols-2 gap-3">
          <input
            required type="number" min={1} placeholder="position" value={form.lessonPosition}
            onChange={(e) => setForm({ ...form, lessonPosition: Number(e.target.value) })}
            className="rounded bg-neutral-900 border border-neutral-700 px-3 py-2"
          />
          <input
            required placeholder="manifest filename" value={form.manifestFilename}
            onChange={(e) => setForm({ ...form, manifestFilename: e.target.value })}
            className="rounded bg-neutral-900 border border-neutral-700 px-3 py-2"
          />
        </div>
        <input
          required placeholder="AES-128 key (32 hex chars)" value={form.aesKeyHex}
          onChange={(e) => setForm({ ...form, aesKeyHex: e.target.value.trim() })}
          pattern="[0-9a-fA-F]{32}"
          className="rounded bg-neutral-900 border border-neutral-700 px-3 py-2 font-mono"
        />
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox" checked={form.isPreview}
            onChange={(e) => setForm({ ...form, isPreview: e.target.checked })}
          />
          Mark as preview (no enrollment required)
        </label>

        <div className="border-2 border-dashed border-neutral-700 rounded p-4">
          <input
            type="file" multiple required
            onChange={(e) => setFiles(e.target.files)}
            accept=".m3u8,.ts"
            className="text-sm"
          />
          <p className="text-xs opacity-60 mt-2">
            Select all .m3u8 + .ts files for this lesson at once.
          </p>
        </div>

        {error && <p className="text-sm text-red-400">{error}</p>}

        {phase === "uploading" && (
          <p className="text-sm opacity-80">Uploading {progress.done}/{progress.total}…</p>
        )}
        {phase === "finalizing" && (
          <p className="text-sm opacity-80">Pushing to R2 and registering key…</p>
        )}
        {phase === "done" && result && (
          <div className="rounded bg-emerald-950/40 border border-emerald-800 p-3 text-sm">
            <p className="font-medium">Upload complete.</p>
            <p className="opacity-80">video_id: <span className="font-mono">{result.video_id}</span></p>
            <p className="opacity-80 break-all">manifest: {result.manifest_url}</p>
          </div>
        )}

        <button
          disabled={phase === "uploading" || phase === "finalizing"}
          className="rounded bg-white text-black font-medium py-2 disabled:opacity-50"
        >
          {phase === "idle" || phase === "done" ? "Upload + register" : "Working…"}
        </button>
      </form>
    </div>
  );
}
