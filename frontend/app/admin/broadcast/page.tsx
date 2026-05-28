"use client";
import { useState } from "react";
import { adminApi } from "@/lib/admin";
import { formatNumber } from "@/lib/format";
import {
  Button, ErrorNote, Field, Input, OkNote, Page, PageTitle, Pill,
  Section, Select, Textarea,
} from "@/components/ui";

type Audience = "all" | "active" | "admins" | "enrolled";

export default function AdminBroadcastPage() {
  const [audience, setAudience] = useState<Audience>("active");
  const [courseSlug, setCourseSlug] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [count, setCount] = useState<number | null>(null);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function preview() {
    setBusy(true); setError(null); setSent(false);
    try {
      const r = await adminApi.emailBroadcast({
        audience, course_slug: courseSlug || undefined,
        subject, body, dry_run: true,
      });
      setCount(r.recipient_count);
    } catch (e: any) { setError(e.message); setCount(null); }
    finally { setBusy(false); }
  }

  async function send() {
    if (count === null) { setError("กดดูจำนวนผู้รับก่อน"); return; }
    if (!confirm(`ส่งจริงให้ผู้รับ ${count} คน?`)) return;
    setBusy(true); setError(null);
    try {
      await adminApi.emailBroadcast({
        audience, course_slug: courseSlug || undefined,
        subject, body, dry_run: false,
      });
      setSent(true);
    } catch (e: any) { setError(e.message); }
    finally { setBusy(false); }
  }

  const needsCourse = audience === "enrolled";

  return (
    <Page>
      <PageTitle kicker="กองบรรณาธิการ">ส่งเมลถึงผู้ใช้</PageTitle>

      <Section
        title="ตั้งค่าการส่ง"
        hint="กดดูจำนวนผู้รับก่อนเสมอ — ระบบจะไม่ส่งจริงจนกว่าจะกดยืนยัน"
      >
        <div className="space-y-5 max-w-2xl">
          <Field label="กลุ่มผู้รับ">
            <Select value={audience} onChange={(e) => { setAudience(e.target.value as Audience); setCount(null); setSent(false); }}>
              <option value="active">ผู้ใช้ที่ยังใช้งาน</option>
              <option value="all">ผู้ใช้ทั้งหมด</option>
              <option value="admins">เฉพาะแอดมิน</option>
              <option value="enrolled">นักเรียนของคอร์สหนึ่ง</option>
            </Select>
          </Field>

          {needsCourse && (
            <Field label="Slug ของคอร์ส">
              <Input
                required
                className="font-mono"
                placeholder="เช่น a-level-physics"
                value={courseSlug}
                onChange={(e) => { setCourseSlug(e.target.value); setCount(null); setSent(false); }}
              />
            </Field>
          )}

          <Field label="หัวข้อ">
            <Input value={subject} onChange={(e) => setSubject(e.target.value)} required />
          </Field>

          <Field label="เนื้อหา">
            <Textarea
              rows={10}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              required
            />
          </Field>

          {error && <ErrorNote>{error}</ErrorNote>}
          {sent && <OkNote>ส่งเข้าคิวเรียบร้อย</OkNote>}
          {count !== null && !sent && (
            <p className="text-[14px] flex items-center gap-3">
              <Pill tone="warn">พรีวิว</Pill>
              จะส่งให้ผู้รับ <strong className="font-mono">{formatNumber(count)}</strong> คน
            </p>
          )}

          <div className="flex flex-wrap gap-3">
            <Button
              tone="ghost"
              type="button"
              disabled={busy || !subject || !body || (needsCourse && !courseSlug)}
              onClick={preview}
            >
              ดูจำนวนผู้รับ
            </Button>
            <Button
              type="button"
              disabled={busy || count === null || count === 0}
              onClick={send}
            >
              ส่งจริง →
            </Button>
          </div>
        </div>
      </Section>
    </Page>
  );
}
