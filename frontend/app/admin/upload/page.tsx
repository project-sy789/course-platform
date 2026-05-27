"use client";
import { useState } from "react";
import { adminApi } from "@/lib/admin";
import {
  Button, ErrorNote, Field, Input, OkNote, Page, PageTitle, Section,
} from "@/components/ui";

type Phase = "idle" | "uploading" | "finalizing" | "done";
type FileEntry = { file: File; relpath: string; filename: string };

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
        const e = entries[i]!;
        await adminApi.uploadFile(upload_id, e.file, e.relpath);
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

  const working = phase === "uploading" || phase === "finalizing";

  return (
    <Page>
      <PageTitle kicker="กองบรรณาธิการ — งานต้นฉบับ">
        อัปโหลดวิดีโอ
      </PageTitle>

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
        <form onSubmit={submit} className="space-y-5 max-w-xl">
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
    </Page>
  );
}
