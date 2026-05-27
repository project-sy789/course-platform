"use client";
import { useState } from "react";
import { adminApi } from "@/lib/admin";

type Phase = "idle" | "uploading" | "finalizing" | "done";

type FileEntry = { file: File; relpath: string; filename: string };

// `webkitRelativePath` is set when an input has the `webkitdirectory` attribute.
// We use it to preserve the directory structure for multi-bitrate HLS uploads.
function entriesFrom(list: FileList): FileEntry[] {
  return Array.from(list).map((f) => {
    const wp = (f as any).webkitRelativePath as string | undefined;
    if (!wp) return { file: f, relpath: "", filename: f.name };
    // Strip the top-level folder name picked by the user, keep subdirs.
    const parts = wp.split("/");
    parts.shift(); // drop top folder
    const filename = parts.pop() || f.name;
    const relpath = parts.join("/");
    return { file: f, relpath, filename };
  });
}

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
    manifestFilename: "master.m3u8",
    isPreview: false,
  });
  const [entries, setEntries] = useState<FileEntry[]>([]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null); setResult(null);
    if (entries.length === 0) { setError("กรุณาเลือกไฟล์ HLS หรือโฟลเดอร์"); return; }
    if (!/^[0-9a-fA-F]{32}$/.test(form.aesKeyHex)) {
      setError("AES key ต้องเป็นเลขฐาน 16 จำนวน 32 ตัวอักษร (16 ไบต์)"); return;
    }
    if (!entries.some((e) => e.relpath === "" && e.filename === form.manifestFilename)) {
      setError(`ไม่พบไฟล์ "${form.manifestFilename}" ในระดับบนสุดของที่เลือก`); return;
    }

    try {
      const { upload_id } = await adminApi.createUpload();

      setPhase("uploading");
      setProgress({ done: 0, total: entries.length });
      for (let i = 0; i < entries.length; i++) {
        const { file, relpath } = entries[i];
        await adminApi.uploadFile(upload_id, file, relpath);
        setProgress({ done: i + 1, total: entries.length });
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
      <h1 className="text-xl font-semibold mb-6">อัปโหลดวิดีโอ</h1>

      <div className="rounded-xl border border-neutral-800 p-4 mb-6 text-sm space-y-2">
        <p className="font-medium">ขั้นตอนเข้ารหัสหลายบิตเรต (รันบนเครื่องก่อนอัปโหลด)</p>
        <pre className="bg-neutral-900 p-3 rounded overflow-x-auto text-xs">{`# ใช้สคริปต์ที่มาพร้อมโปรเจกต์:
cd backend/scripts
./encode_multibitrate.sh source.mp4 ./out

# จะได้ผลลัพธ์:
#   out/master.m3u8           ← master playlist ระดับบนสุด
#   out/360p/index.m3u8 + seg_*.ts
#   out/720p/index.m3u8 + seg_*.ts
#   out/1080p/index.m3u8 + seg_*.ts
#   out/key.hex               ← เลขฐาน 16 จำนวน 32 ตัว (กรอกในฟอร์ม)
#
# จากนั้นเลือกโฟลเดอร์ "out" ในตัวเลือกไฟล์ด้านล่าง
# เบราว์เซอร์จะคงโครงสร้าง 360p/, 720p/, 1080p/ ไว้`}</pre>
      </div>

      <form onSubmit={submit} className="rounded-xl border border-neutral-800 p-4 grid gap-3">
        <input
          required placeholder="slug ของคอร์ส" value={form.courseSlug}
          onChange={(e) => setForm({ ...form, courseSlug: e.target.value })}
          className="rounded bg-neutral-900 border border-neutral-700 px-3 py-2"
        />
        <input
          required placeholder="ชื่อบทเรียน" value={form.lessonTitle}
          onChange={(e) => setForm({ ...form, lessonTitle: e.target.value })}
          className="rounded bg-neutral-900 border border-neutral-700 px-3 py-2"
        />
        <div className="grid grid-cols-2 gap-3">
          <input
            required type="number" min={1} placeholder="ลำดับ" value={form.lessonPosition}
            onChange={(e) => setForm({ ...form, lessonPosition: Number(e.target.value) })}
            className="rounded bg-neutral-900 border border-neutral-700 px-3 py-2"
          />
          <input
            required placeholder="ชื่อไฟล์ manifest" value={form.manifestFilename}
            onChange={(e) => setForm({ ...form, manifestFilename: e.target.value })}
            className="rounded bg-neutral-900 border border-neutral-700 px-3 py-2"
          />
        </div>
        <input
          required placeholder="คีย์ AES-128 (เลขฐาน 16 จำนวน 32 ตัว)" value={form.aesKeyHex}
          onChange={(e) => setForm({ ...form, aesKeyHex: e.target.value.trim() })}
          pattern="[0-9a-fA-F]{32}"
          className="rounded bg-neutral-900 border border-neutral-700 px-3 py-2 font-mono"
        />
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox" checked={form.isPreview}
            onChange={(e) => setForm({ ...form, isPreview: e.target.checked })}
          />
          ตั้งเป็นบทเรียนตัวอย่าง (ดูได้โดยไม่ต้องลงทะเบียน)
        </label>

        <div className="border-2 border-dashed border-neutral-700 rounded p-4 space-y-3">
          <div>
            <p className="text-sm font-medium mb-1">อัปโหลดทั้งโฟลเดอร์ (หลายบิตเรต)</p>
            <input
              type="file"
              // @ts-expect-error – non-standard but widely supported
              webkitdirectory=""
              directory=""
              multiple
              onChange={(e) => e.target.files && setEntries(entriesFrom(e.target.files))}
              className="text-sm"
            />
          </div>
          <div className="text-xs opacity-50 text-center">— หรือ —</div>
          <div>
            <p className="text-sm font-medium mb-1">บิตเรตเดียว (เลือกไฟล์แบบไม่มีโฟลเดอร์ย่อย)</p>
            <input
              type="file" multiple
              accept=".m3u8,.ts"
              onChange={(e) => e.target.files && setEntries(entriesFrom(e.target.files))}
              className="text-sm"
            />
          </div>
          {entries.length > 0 && (
            <p className="text-xs opacity-70">
              เลือกไฟล์ {entries.length} รายการ{" "}
              ({new Set(entries.map((e) => e.relpath || ".")).size} โฟลเดอร์ย่อย)
            </p>
          )}
        </div>

        {error && <p className="text-sm text-red-400">{error}</p>}

        {phase === "uploading" && (
          <p className="text-sm opacity-80">กำลังอัปโหลด {progress.done}/{progress.total}…</p>
        )}
        {phase === "finalizing" && (
          <p className="text-sm opacity-80">กำลังส่งขึ้น R2 และลงทะเบียนคีย์…</p>
        )}
        {phase === "done" && result && (
          <div className="rounded bg-emerald-950/40 border border-emerald-800 p-3 text-sm">
            <p className="font-medium">อัปโหลดเสร็จสมบูรณ์</p>
            <p className="opacity-80">video_id: <span className="font-mono">{result.video_id}</span></p>
            <p className="opacity-80 break-all">manifest: {result.manifest_url}</p>
          </div>
        )}

        <button
          disabled={phase === "uploading" || phase === "finalizing"}
          className="rounded bg-white text-black font-medium py-2 disabled:opacity-50"
        >
          {phase === "idle" || phase === "done" ? "อัปโหลดและลงทะเบียน" : "กำลังประมวลผล…"}
        </button>
      </form>
    </div>
  );
}
