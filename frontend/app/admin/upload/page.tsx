"use client";
import { useEffect, useRef, useState } from "react";
import { adminApi } from "@/lib/admin";
import {
  Button, ErrorNote, Field, Input, OkNote, Page, PageTitle, Pill, Section,
} from "@/components/ui";

type Mode = "auto" | "manual";
type Phase = "idle" | "uploading" | "enqueuing" | "encoding" | "finalizing" | "done";
type FileEntry = { file: File; relpath: string; filename: string };

type EncodeJobRow = {
  id: string;
  upload_id: string;
  course_slug: string;
  lesson_title: string;
  status: string;
  error: string | null;
  video_id: string | null;
  created_at: string;
};

function entriesFrom(list: FileList): FileEntry[] {
  return Array.from(list).map((f) => {
    const wp = (f as any).webkitRelativePath as string | undefined;
    if (!wp) return { file: f, relpath: "", filename: f.name };
    const parts = wp.split("/");
    parts.shift();
    const filename = parts.pop() || f.name;
    const relpath = parts.join("/");
    return { file: f, relpath, filename };
  });
}

function statusTone(s: string): "ok" | "warn" | "danger" | "neutral" {
  if (s === "done") return "ok";
  if (s === "failed") return "danger";
  if (s === "encoding" || s === "queued") return "warn";
  return "neutral";
}

function statusLabel(s: string): string {
  if (s === "queued") return "เข้าคิวแล้ว";
  if (s === "encoding") return "กำลังแปลง";
  if (s === "done") return "เสร็จสิ้น";
  if (s === "failed") return "ล้มเหลว";
  return s;
}

export default function AdminUploadPage() {
  const [mode, setMode] = useState<Mode>("auto");
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ video_id: string; manifest_url?: string } | null>(null);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [jobs, setJobs] = useState<EncodeJobRow[]>([]);

  const [form, setForm] = useState({
    courseSlug: "",
    lessonTitle: "",
    lessonPosition: 1,
    aesKeyHex: "",
    manifestFilename: "master.m3u8",
    isPreview: false,
  });
  const [mp4, setMp4] = useState<File | null>(null);
  const [entries, setEntries] = useState<FileEntry[]>([]);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  async function refreshJobs() {
    try {
      const list = await adminApi.listEncodeJobs(20);
      setJobs(list);
      if (activeJobId) {
        const j = list.find((x) => x.id === activeJobId);
        if (j && (j.status === "done" || j.status === "failed")) {
          if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
          if (j.status === "done" && j.video_id) {
            setResult({ video_id: j.video_id });
            setPhase("done");
          } else if (j.status === "failed") {
            setError(j.error ?? "encode failed");
            setPhase("idle");
          }
        }
      }
    } catch {
      /* keep polling */
    }
  }

  useEffect(() => {
    refreshJobs();
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function startPolling() {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(refreshJobs, 3000);
  }

  async function submitAuto(e: React.FormEvent) {
    e.preventDefault();
    setError(null); setResult(null);
    if (!mp4) { setError("กรุณาเลือกไฟล์ MP4 ต้นฉบับ"); return; }
    try {
      const { upload_id } = await adminApi.createUpload();
      setPhase("uploading");
      setProgress({ done: 0, total: 1 });
      await adminApi.uploadFile(upload_id, mp4, "");
      setProgress({ done: 1, total: 1 });

      setPhase("enqueuing");
      const job = await adminApi.enqueueEncode({
        upload_id,
        course_slug: form.courseSlug,
        lesson_title: form.lessonTitle,
        lesson_position: Number(form.lessonPosition),
        is_preview: form.isPreview,
      });
      setActiveJobId(job.job_id);
      setPhase("encoding");
      startPolling();
      refreshJobs();
    } catch (e: any) {
      setError(e.message);
      setPhase("idle");
    }
  }

  async function submitManual(e: React.FormEvent) {
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
        const ent = entries[i]!;
        await adminApi.uploadFile(upload_id, ent.file, ent.relpath);
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

  const working = phase !== "idle" && phase !== "done";

  return (
    <Page>
      <PageTitle kicker="กองบรรณาธิการ — งานต้นฉบับ">
        อัปโหลดวิดีโอ
      </PageTitle>

      <Section
        title="โหมดการอัปโหลด"
        hint="เลือกไฟล์ MP4 อย่างเดียว — ระบบจะแปลงเป็น HLS แบบหลายบิตเรตและเข้ารหัส AES ให้อัตโนมัติ"
      >
        <div className="grid sm:grid-cols-2 gap-3">
          <label className={`cursor-pointer border p-4 flex gap-3 items-start transition ${
            mode === "auto" ? "border-ink bg-cream/40" : "border-rule hover:border-ink/60"
          }`}>
            <input
              type="radio" name="mode" value="auto"
              checked={mode === "auto"}
              onChange={() => setMode("auto")}
              className="mt-1 accent-oxblood w-4 h-4"
            />
            <span>
              <span className="font-display text-[16px] block">อัปโหลดอัตโนมัติ</span>
              <span className="block text-[12px] text-muted mt-1 leading-relaxed">
                ส่งไฟล์ MP4 ดิบ — เซิร์ฟเวอร์แปลงเป็น 360p / 720p / 1080p
                และสร้างคีย์ AES ให้เอง
              </span>
            </span>
          </label>
          <label className={`cursor-pointer border p-4 flex gap-3 items-start transition ${
            mode === "manual" ? "border-ink bg-cream/40" : "border-rule hover:border-ink/60"
          }`}>
            <input
              type="radio" name="mode" value="manual"
              checked={mode === "manual"}
              onChange={() => setMode("manual")}
              className="mt-1 accent-oxblood w-4 h-4"
            />
            <span>
              <span className="font-display text-[16px] block">
                อัปโหลด HLS ที่เข้ารหัสแล้ว
                <span className="ml-2 text-[10px] uppercase tracking-[0.18em] text-muted">advanced</span>
              </span>
              <span className="block text-[12px] text-muted mt-1 leading-relaxed">
                ถ้าเข้ารหัส HLS+AES ด้วยสคริปต์เองแล้ว
                ให้อัปโหลดทั้งโฟลเดอร์พร้อมคีย์
              </span>
            </span>
          </label>
        </div>
      </Section>

      {mode === "auto" ? (
        <Section
          title="รายละเอียดบทเรียน"
          hint="ระบบจะสร้างบทเรียนใหม่ใต้คอร์สที่ระบุหลังการแปลงไฟล์เสร็จ"
        >
          <form onSubmit={submitAuto} className="space-y-5 max-w-xl">
            <Field label="Slug คอร์ส">
              <Input required value={form.courseSlug} className="font-mono"
                onChange={(e) => setForm({ ...form, courseSlug: e.target.value })} />
            </Field>
            <Field label="ชื่อบทเรียน">
              <Input required value={form.lessonTitle}
                onChange={(e) => setForm({ ...form, lessonTitle: e.target.value })} />
            </Field>
            <Field label="ลำดับ">
              <Input required type="number" min={1} value={form.lessonPosition}
                className="font-mono w-32"
                onChange={(e) => setForm({ ...form, lessonPosition: Number(e.target.value) })} />
            </Field>

            <label className="flex items-start gap-3 text-[14px] cursor-pointer pt-1">
              <input
                type="checkbox" checked={form.isPreview}
                onChange={(e) => setForm({ ...form, isPreview: e.target.checked })}
                className="mt-[5px] accent-oxblood w-4 h-4"
              />
              <span>
                <span className="font-display text-[16px]">
                  ตั้งเป็นบทเรียนตัวอย่าง
                </span>
                <span className="block text-[12px] text-muted mt-1">
                  ผู้เยี่ยมชมที่ยังไม่ได้ลงทะเบียนก็เปิดดูได้
                </span>
              </span>
            </label>

            <div className="border-t border-rule pt-6 mt-4">
              <p className="text-[11px] uppercase tracking-[0.22em] text-muted mb-4">
                ไฟล์ต้นฉบับ
              </p>
              <div className="border border-dashed border-rule p-5">
                <p className="font-display text-[15px] mb-2">วิดีโอ MP4</p>
                <input
                  type="file" accept="video/mp4,video/quicktime"
                  onChange={(e) => setMp4(e.target.files?.[0] ?? null)}
                  className="text-[13px] file:mr-3 file:border file:border-ink file:bg-ink
                             file:text-paper file:px-3 file:py-1.5 file:text-[11px]
                             file:uppercase file:tracking-[0.14em] file:cursor-pointer
                             hover:file:bg-oxblood hover:file:border-oxblood"
                />
                {mp4 && (
                  <p className="text-[12px] text-muted font-mono mt-3">
                    {mp4.name} · {(mp4.size / (1024 * 1024)).toFixed(1)} MB
                  </p>
                )}
                <p className="text-[11px] text-muted mt-3 leading-relaxed">
                  เซิร์ฟเวอร์จะเข้ารหัสเป็น H.264 หลายบิตเรตและห่อด้วย HLS+AES-128
                  ก่อนเก็บลง R2 — ใช้เวลาประมาณความยาววิดีโอ × ๒
                </p>
              </div>
            </div>

            <ErrorNote>{error}</ErrorNote>

            {phase === "uploading" && (
              <p className="text-[13px] font-mono text-muted">
                กำลังอัปโหลดไฟล์ต้นฉบับ…
              </p>
            )}
            {phase === "enqueuing" && (
              <p className="text-[13px] font-mono text-muted">
                กำลังส่งเข้าคิวงานแปลง…
              </p>
            )}
            {phase === "encoding" && (
              <p className="text-[13px] font-mono text-muted">
                ระบบกำลังแปลงไฟล์ — ดูสถานะด้านล่าง
              </p>
            )}
            {phase === "done" && result && (
              <OkNote>
                แปลงและลงทะเบียนเสร็จสมบูรณ์ —{" "}
                <span className="font-mono">{result.video_id}</span>
              </OkNote>
            )}

            <Button disabled={working}>
              {working ? "กำลังประมวลผล…" : "อัปโหลดและแปลงอัตโนมัติ →"}
            </Button>
          </form>
        </Section>
      ) : (
        <>
          <Section
            title="เตรียมไฟล์ก่อนอัปโหลด"
            hint="เข้ารหัสหลายบิตเรตด้วยสคริปต์บนเครื่องของคุณ แล้วจึงเลือกโฟลเดอร์ที่ได้"
          >
            <pre className="bg-cream/60 border-l-2 border-ink p-4 overflow-x-auto text-[12px] font-mono leading-relaxed">{`# จากรากของโปรเจกต์:
cd backend/scripts
./encode_multibitrate.sh source.mp4 ./out

# ผลลัพธ์:
#   out/master.m3u8                ← master playlist
#   out/360p/index.m3u8 + seg_*.ts
#   out/720p/index.m3u8 + seg_*.ts
#   out/1080p/index.m3u8 + seg_*.ts
#   out/key.hex                    ← 32 hex chars — กรอกในฟอร์ม
#
# จากนั้นเลือกโฟลเดอร์ "out" ในตัวเลือกไฟล์ด้านล่าง
# เบราว์เซอร์จะเก็บโครงสร้าง 360p/, 720p/, 1080p/ ไว้ครบ`}</pre>
          </Section>

          <Section
            title="รายละเอียดบทเรียน"
            hint="ระบบจะสร้างบทเรียนใหม่ใต้คอร์สที่ระบุ และผูกกับวิดีโอที่เพิ่งอัปโหลด"
          >
            <form onSubmit={submitManual} className="space-y-5 max-w-xl">
              <Field label="Slug คอร์ส">
                <Input required value={form.courseSlug} className="font-mono"
                  onChange={(e) => setForm({ ...form, courseSlug: e.target.value })} />
              </Field>
              <Field label="ชื่อบทเรียน">
                <Input required value={form.lessonTitle}
                  onChange={(e) => setForm({ ...form, lessonTitle: e.target.value })} />
              </Field>
              <div className="grid grid-cols-2 gap-6">
                <Field label="ลำดับ">
                  <Input required type="number" min={1} value={form.lessonPosition}
                    className="font-mono"
                    onChange={(e) => setForm({ ...form, lessonPosition: Number(e.target.value) })} />
                </Field>
                <Field label="ชื่อไฟล์ manifest">
                  <Input required value={form.manifestFilename} className="font-mono"
                    onChange={(e) => setForm({ ...form, manifestFilename: e.target.value })} />
                </Field>
              </div>
              <Field label="คีย์ AES-128" hint="เลขฐาน ๑๖ จำนวน ๓๒ ตัว (๑๖ ไบต์)">
                <Input required pattern="[0-9a-fA-F]{32}" className="font-mono text-[13px]"
                  value={form.aesKeyHex}
                  onChange={(e) => setForm({ ...form, aesKeyHex: e.target.value.trim() })} />
              </Field>

              <label className="flex items-start gap-3 text-[14px] cursor-pointer pt-1">
                <input
                  type="checkbox" checked={form.isPreview}
                  onChange={(e) => setForm({ ...form, isPreview: e.target.checked })}
                  className="mt-[5px] accent-oxblood w-4 h-4"
                />
                <span>
                  <span className="font-display text-[16px]">
                    ตั้งเป็นบทเรียนตัวอย่าง
                  </span>
                  <span className="block text-[12px] text-muted mt-1">
                    ผู้เยี่ยมชมที่ยังไม่ได้ลงทะเบียนก็เปิดดูได้
                  </span>
                </span>
              </label>

              <div className="border-t border-rule pt-6 mt-4">
                <p className="text-[11px] uppercase tracking-[0.22em] text-muted mb-4">
                  เลือกไฟล์
                </p>
                <div className="border border-dashed border-rule p-5 space-y-5">
                  <div>
                    <p className="font-display text-[15px] mb-2">โฟลเดอร์ทั้งหมด (หลายบิตเรต)</p>
                    <input
                      type="file"
                      // @ts-expect-error non-standard but widely supported
                      webkitdirectory=""
                      directory=""
                      multiple
                      onChange={(e) => e.target.files && setEntries(entriesFrom(e.target.files))}
                      className="text-[13px] file:mr-3 file:border file:border-ink file:bg-ink
                                 file:text-paper file:px-3 file:py-1.5 file:text-[11px]
                                 file:uppercase file:tracking-[0.14em] file:cursor-pointer
                                 hover:file:bg-oxblood hover:file:border-oxblood"
                    />
                  </div>
                  <div className="text-[10px] uppercase tracking-[0.22em] text-muted text-center">
                    — หรือ —
                  </div>
                  <div>
                    <p className="font-display text-[15px] mb-2">บิตเรตเดียว (ไฟล์เดี่ยว)</p>
                    <input
                      type="file" multiple accept=".m3u8,.ts"
                      onChange={(e) => e.target.files && setEntries(entriesFrom(e.target.files))}
                      className="text-[13px] file:mr-3 file:border file:border-ink file:bg-ink
                                 file:text-paper file:px-3 file:py-1.5 file:text-[11px]
                                 file:uppercase file:tracking-[0.14em] file:cursor-pointer
                                 hover:file:bg-oxblood hover:file:border-oxblood"
                    />
                  </div>
                  {entries.length > 0 && (
                    <p className="text-[12px] text-muted font-mono">
                      เลือก {entries.length} ไฟล์ ·{" "}
                      {new Set(entries.map((e) => e.relpath || ".")).size} โฟลเดอร์ย่อย
                    </p>
                  )}
                </div>
              </div>

              <ErrorNote>{error}</ErrorNote>

              {phase === "uploading" && (
                <p className="text-[13px] font-mono text-muted">
                  กำลังอัปโหลด {progress.done}/{progress.total}…
                </p>
              )}
              {phase === "finalizing" && (
                <p className="text-[13px] font-mono text-muted">
                  กำลังส่งขึ้น R2 และลงทะเบียนคีย์…
                </p>
              )}
              {phase === "done" && result && (
                <OkNote>
                  อัปโหลดเสร็จสมบูรณ์ —{" "}
                  <span className="font-mono">{result.video_id}</span>
                </OkNote>
              )}

              <Button disabled={working}>
                {working ? "กำลังประมวลผล…" : "อัปโหลดและลงทะเบียน →"}
              </Button>
            </form>
          </Section>
        </>
      )}

      <Section
        title="คิวงานแปลง"
        hint="งานล่าสุด — รีเฟรชอัตโนมัติทุก ๓ วินาทีระหว่างที่มีงานกำลังทำ"
      >
        {jobs.length === 0 ? (
          <p className="text-[13px] text-muted italic">ยังไม่มีงานแปลง</p>
        ) : (
          <ol className="border-t border-rule">
            {jobs.map((j) => (
              <li key={j.id} className={`border-b border-rule py-3 grid grid-cols-[1fr_auto] gap-4 items-baseline ${
                j.id === activeJobId ? "bg-cream/40 -mx-2 px-2" : ""
              }`}>
                <div>
                  <div className="font-display text-[15px]">
                    {j.lesson_title}
                    <span className="text-muted text-[12px] ml-2 font-mono">
                      · {j.course_slug}
                    </span>
                  </div>
                  <div className="text-[11px] text-muted font-mono mt-0.5">
                    {new Date(j.created_at).toLocaleString("th-TH")}
                    {j.video_id && <> · video {j.video_id.slice(0, 8)}…</>}
                    {j.error && <span className="text-oxblood"> · {j.error}</span>}
                  </div>
                </div>
                <Pill tone={statusTone(j.status)}>{statusLabel(j.status)}</Pill>
              </li>
            ))}
          </ol>
        )}
        <button
          type="button"
          onClick={refreshJobs}
          className="mt-4 text-[12px] uppercase tracking-[0.18em] text-muted hover:text-ink underline underline-offset-4"
        >
          รีเฟรช
        </button>
      </Section>
    </Page>
  );
}
