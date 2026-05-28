"use client";
import { useEffect, useMemo, useState } from "react";
import {
  adminApi, Coupon, CouponInput, CouponKind, CouponScope, CouponRedemption,
} from "@/lib/admin";
import { apiFetch, ApiError } from "@/lib/api";
import { formatTHB, formatThaiDateTime } from "@/lib/format";
import {
  Button, ErrorNote, Field, Input, Loading, OkNote, Page, PageTitle, Pill,
  Section, StatusDot,
} from "@/components/ui";

type CourseLite = { slug: string; title: string };

const KIND_LABEL: Record<CouponKind, string> = {
  fixed: "ลดเป็นบาท",
  percent: "ลดเป็น %",
  full: "ฟรี ๑๐๐%",
};
const SCOPE_LABEL: Record<CouponScope, string> = {
  all: "ทั้งร้าน",
  course: "เฉพาะคอร์ส",
  lesson: "เฉพาะบทเรียน",
};

const EMPTY_FORM: CouponInput = {
  code: "",
  kind: "percent",
  percent: 10,
  amount_baht: null,
  max_discount_baht: null,
  min_purchase_baht: 0,
  scope: "all",
  target_course_slug: null,
  target_lesson_id: null,
  valid_from: null,
  valid_until: null,
  usage_limit: null,
  per_user_limit: null,
  is_active: true,
  note: null,
};

function describe(c: Coupon): string {
  if (c.kind === "full") return "ฟรี ๑๐๐%";
  if (c.kind === "fixed") return `ลด ${formatTHB(c.amount_baht ?? 0)}`;
  const cap = c.max_discount_baht
    ? ` (สูงสุด ${formatTHB(c.max_discount_baht)})`
    : "";
  return `ลด ${c.percent}%${cap}`;
}

function dtLocal(iso: string | null | undefined): string {
  if (!iso) return "";
  // datetime-local needs "YYYY-MM-DDTHH:mm"
  return iso.slice(0, 16);
}

export default function AdminCouponsPage() {
  const [rows, setRows] = useState<Coupon[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  const [editing, setEditing] = useState<Coupon | null>(null);
  const [form, setForm] = useState<CouponInput>(EMPTY_FORM);

  const [courses, setCourses] = useState<CourseLite[]>([]);
  const [redemptionsFor, setRedemptionsFor] = useState<Coupon | null>(null);
  const [redemptions, setRedemptions] = useState<CouponRedemption[] | null>(null);

  function load() {
    adminApi.listCoupons()
      .then(setRows)
      .catch((e: ApiError) => setErr(e.message));
  }

  useEffect(() => {
    load();
    apiFetch<{ slug: string; title: string }[]>("/api/v1/courses")
      .then((cs) => setCourses(cs.map((c) => ({ slug: c.slug, title: c.title }))))
      .catch(() => { /* ignore */ });
  }, []);

  function startCreate() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setMsg(null); setOk(false);
  }

  function startEdit(c: Coupon) {
    setEditing(c);
    setForm({
      code: c.code,
      kind: c.kind,
      amount_baht: c.amount_baht,
      percent: c.percent,
      max_discount_baht: c.max_discount_baht,
      min_purchase_baht: c.min_purchase_baht,
      scope: c.scope,
      target_course_slug: c.target_course_slug,
      target_lesson_id: c.target_lesson_id,
      valid_from: c.valid_from,
      valid_until: c.valid_until,
      usage_limit: c.usage_limit,
      per_user_limit: c.per_user_limit,
      is_active: c.is_active,
      note: c.note,
    });
    setMsg(null); setOk(false);
  }

  async function submit() {
    setBusy(true); setMsg(null); setOk(false);
    try {
      // Clean payload — strip fields that don't apply to the chosen kind/scope.
      const body: CouponInput = { ...form, code: form.code.trim().toUpperCase() };
      if (body.kind !== "fixed") body.amount_baht = null;
      if (body.kind !== "percent") {
        body.percent = null;
        body.max_discount_baht = null;
      }
      if (body.scope !== "course") body.target_course_slug = null;
      if (body.scope !== "lesson") body.target_lesson_id = null;
      if (editing) {
        await adminApi.updateCoupon(editing.id, body);
      } else {
        await adminApi.createCoupon(body);
      }
      setOk(true); setMsg(editing ? "บันทึกแล้ว" : "สร้างคูปองแล้ว");
      load();
      if (!editing) {
        setForm(EMPTY_FORM);
      }
    } catch (e: any) {
      setMsg(e?.message ?? "ผิดพลาด");
    } finally { setBusy(false); }
  }

  async function deactivate(c: Coupon) {
    if (!window.confirm(`ปิดคูปอง "${c.code}" ?`)) return;
    try {
      await adminApi.deactivateCoupon(c.id);
      load();
    } catch (e: any) { setErr(e?.message ?? "ผิดพลาด"); }
  }

  async function showRedemptions(c: Coupon) {
    setRedemptionsFor(c); setRedemptions(null);
    try {
      const list = await adminApi.couponRedemptions(c.id);
      setRedemptions(list);
    } catch (e: any) { setErr(e?.message ?? "ผิดพลาด"); }
  }

  if (err) return <Page><ErrorNote>{err}</ErrorNote></Page>;
  if (!rows) return <Page><Loading /></Page>;

  return (
    <Page>
      <PageTitle kicker="กองบรรณาธิการ — โปรโมชัน">
        คูปองส่วนลด
      </PageTitle>

      <p className="text-[13px] text-muted leading-relaxed -mt-6 mb-6 max-w-prose">
        สร้างโค้ดส่วนลดให้ผู้ซื้อกรอกตอนอัปโหลดสลิป ระบบจะคำนวณยอดที่ต้องโอนให้ใหม่
        และนับการใช้งานเข้า ledger เฉพาะเมื่อสลิปได้รับการอนุมัติ — สลิปที่ถูกตีกลับ
        ไม่กิน quota ของคูปอง
      </p>

      <Section
        title={editing ? `แก้ไขคูปอง · ${editing.code}` : "สร้างคูปองใหม่"}
        hint={editing
          ? "เปลี่ยนค่าได้ทุกฟิลด์ยกเว้นโค้ด · ปิดด้วยปุ่ม “ปิดคูปอง”"
          : "โค้ดจะถูกแปลงเป็นตัวพิมพ์ใหญ่อัตโนมัติ — ผู้ใช้กรอกพิมพ์เล็กก็ใช้ได้"}
      >
        <div className="grid sm:grid-cols-2 gap-x-6 gap-y-5 max-w-3xl">
          <Field label="โค้ด" hint="ตัวอักษร/ตัวเลข เช่น WELCOME10">
            <Input
              className="font-mono uppercase"
              value={form.code}
              disabled={!!editing}
              onChange={(e) => setForm({ ...form, code: e.target.value })}
            />
          </Field>
          <Field label="ประเภทส่วนลด">
            <select
              className="border border-rule/60 px-3 py-2 bg-paper text-[13px] w-full"
              value={form.kind}
              onChange={(e) => setForm({ ...form, kind: e.target.value as CouponKind })}
            >
              <option value="percent">ลดเป็น % ของราคา</option>
              <option value="fixed">ลดเป็นบาท</option>
              <option value="full">ฟรี ๑๐๐% (ใช้แทนการโอน)</option>
            </select>
          </Field>

          {form.kind === "percent" && (
            <>
              <Field label="ส่วนลด (%)" hint="๑–๑๐๐">
                <Input
                  type="number" min={1} max={100}
                  value={form.percent ?? ""}
                  onChange={(e) => setForm({
                    ...form,
                    percent: e.target.value ? Number(e.target.value) : null,
                  })}
                />
              </Field>
              <Field label="เพดานส่วนลด (บาท)" hint="เว้นว่าง = ไม่จำกัด">
                <Input
                  type="number" min={0}
                  value={form.max_discount_baht ?? ""}
                  onChange={(e) => setForm({
                    ...form,
                    max_discount_baht: e.target.value ? Number(e.target.value) : null,
                  })}
                />
              </Field>
            </>
          )}

          {form.kind === "fixed" && (
            <Field label="ลดเป็นบาท" hint="หักออกจากราคาคงเหลือไม่ติดลบ">
              <Input
                type="number" min={1}
                value={form.amount_baht ?? ""}
                onChange={(e) => setForm({
                  ...form,
                  amount_baht: e.target.value ? Number(e.target.value) : null,
                })}
              />
            </Field>
          )}

          <Field label="ยอดซื้อขั้นต่ำ (บาท)" hint="0 = ไม่มีขั้นต่ำ">
            <Input
              type="number" min={0}
              value={form.min_purchase_baht ?? 0}
              onChange={(e) => setForm({
                ...form, min_purchase_baht: Number(e.target.value || 0),
              })}
            />
          </Field>

          <Field label="ขอบเขต">
            <select
              className="border border-rule/60 px-3 py-2 bg-paper text-[13px] w-full"
              value={form.scope}
              onChange={(e) => setForm({ ...form, scope: e.target.value as CouponScope })}
            >
              <option value="all">ทั้งร้าน — ใช้ได้กับทุกคอร์ส/บทเรียน</option>
              <option value="course">เฉพาะคอร์สที่เลือก</option>
              <option value="lesson">เฉพาะบทเรียนที่เลือก</option>
            </select>
          </Field>

          {form.scope === "course" && (
            <Field label="คอร์สเป้าหมาย">
              <select
                className="border border-rule/60 px-3 py-2 bg-paper text-[13px] w-full"
                value={form.target_course_slug ?? ""}
                onChange={(e) => setForm({
                  ...form, target_course_slug: e.target.value || null,
                })}
              >
                <option value="">— เลือก —</option>
                {courses.map((c) => (
                  <option key={c.slug} value={c.slug}>{c.title}</option>
                ))}
              </select>
            </Field>
          )}
          {form.scope === "lesson" && (
            <Field label="lesson_id" hint="UUID ของบทเรียน">
              <Input
                className="font-mono"
                value={form.target_lesson_id ?? ""}
                onChange={(e) => setForm({
                  ...form, target_lesson_id: e.target.value || null,
                })}
              />
            </Field>
          )}

          <Field label="ใช้ได้ตั้งแต่" hint="เว้นว่าง = ตอนนี้เลย">
            <Input
              type="datetime-local"
              value={dtLocal(form.valid_from)}
              onChange={(e) => setForm({
                ...form, valid_from: e.target.value
                  ? new Date(e.target.value).toISOString() : null,
              })}
            />
          </Field>
          <Field label="หมดอายุเมื่อ" hint="เว้นว่าง = ใช้ได้ไม่จำกัดเวลา">
            <Input
              type="datetime-local"
              value={dtLocal(form.valid_until)}
              onChange={(e) => setForm({
                ...form, valid_until: e.target.value
                  ? new Date(e.target.value).toISOString() : null,
              })}
            />
          </Field>
          <Field label="จำนวนใช้สูงสุดทั้งระบบ" hint="เว้นว่าง = ไม่จำกัด">
            <Input
              type="number" min={1}
              value={form.usage_limit ?? ""}
              onChange={(e) => setForm({
                ...form, usage_limit: e.target.value ? Number(e.target.value) : null,
              })}
            />
          </Field>
          <Field label="จำกัดต่อผู้ใช้" hint="เว้นว่าง = ใช้ซ้ำได้">
            <Input
              type="number" min={1}
              value={form.per_user_limit ?? ""}
              onChange={(e) => setForm({
                ...form, per_user_limit: e.target.value ? Number(e.target.value) : null,
              })}
            />
          </Field>
          <Field label="หมายเหตุ (เห็นเฉพาะแอดมิน)">
            <Input
              value={form.note ?? ""}
              onChange={(e) => setForm({ ...form, note: e.target.value || null })}
            />
          </Field>
        </div>

        {msg && (ok ? <OkNote>{msg}</OkNote> : <ErrorNote>{msg}</ErrorNote>)}

        <div className="mt-6 flex items-center gap-4">
          <Button onClick={submit} disabled={busy || !form.code.trim()}>
            {busy ? "กำลังบันทึก…" : (editing ? "บันทึกการแก้ไข →" : "สร้างคูปอง →")}
          </Button>
          {editing && (
            <button
              onClick={startCreate}
              className="text-[12px] text-muted hover:text-ink underline underline-offset-4 decoration-1"
            >
              ยกเลิก ↺
            </button>
          )}
        </div>
      </Section>

      <Section
        title="คูปองที่มีอยู่"
        hint={`${rows.length} รายการ · เรียงจากใหม่ไปเก่า`}
      >
        {rows.length === 0 ? (
          <p className="text-muted italic">ยังไม่มีคูปอง</p>
        ) : (
          <ul className="border-t border-rule">
            {rows.map((c) => (
              <li
                key={c.id}
                className="border-b border-rule/40 py-4 flex items-start gap-4 flex-wrap"
              >
                <div className="grow min-w-[14rem]">
                  <div className="flex items-center gap-3 flex-wrap">
                    <span className="font-mono text-[15px] font-semibold tracking-wide">
                      {c.code}
                    </span>
                    <Pill tone={c.is_active ? "ok" : "neutral"}>
                      {c.is_active ? "เปิดใช้" : "ปิด"}
                    </Pill>
                    <Pill tone="neutral">{KIND_LABEL[c.kind]}</Pill>
                    <Pill tone="neutral">{SCOPE_LABEL[c.scope]}</Pill>
                  </div>
                  <p className="text-[13px] text-ink mt-1">
                    {describe(c)}
                    {c.scope === "course" && c.target_course_slug
                      && <> · คอร์ส <code className="font-mono">{c.target_course_slug}</code></>}
                    {c.scope === "lesson" && c.target_lesson_title
                      && <> · บท “{c.target_lesson_title}”</>}
                    {c.min_purchase_baht > 0
                      && <> · ขั้นต่ำ {formatTHB(c.min_purchase_baht)}</>}
                  </p>
                  <p className="text-[12px] text-muted mt-1">
                    ใช้ไปแล้ว {c.usage_count}
                    {c.usage_limit != null && <> / {c.usage_limit}</>}
                    {c.per_user_limit != null && <> · {c.per_user_limit}/คน</>}
                    {c.valid_from && <> · เริ่ม {formatThaiDateTime(c.valid_from)}</>}
                    {c.valid_until && <> · หมดอายุ {formatThaiDateTime(c.valid_until)}</>}
                  </p>
                  {c.note && (
                    <p className="text-[12px] text-muted italic mt-1">{c.note}</p>
                  )}
                </div>
                <div className="flex items-center gap-3 text-[12px]">
                  <button
                    onClick={() => showRedemptions(c)}
                    className="text-muted hover:text-ink underline underline-offset-4 decoration-1"
                  >
                    ประวัติ
                  </button>
                  <button
                    onClick={() => startEdit(c)}
                    className="text-muted hover:text-ink underline underline-offset-4 decoration-1"
                  >
                    แก้ไข
                  </button>
                  {c.is_active && (
                    <button
                      onClick={() => deactivate(c)}
                      className="text-oxblood hover:underline underline-offset-4 decoration-1"
                    >
                      ปิด
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {redemptionsFor && (
        <Section
          title={`ประวัติการใช้ · ${redemptionsFor.code}`}
          hint={`คูปองนี้ถูกใช้ ${redemptionsFor.usage_count} ครั้ง`}
        >
          {redemptions === null ? (
            <Loading />
          ) : redemptions.length === 0 ? (
            <p className="text-muted italic">ยังไม่มีการใช้</p>
          ) : (
            <ul className="border-t border-rule">
              {redemptions.map((r) => (
                <li key={r.id} className="border-b border-rule/40 py-3 text-[13px]">
                  <div className="flex items-baseline justify-between gap-4 flex-wrap">
                    <span className="font-mono">{r.user_email ?? r.user_id}</span>
                    <span className="text-muted">{formatThaiDateTime(r.redeemed_at)}</span>
                  </div>
                  <p className="text-[12px] text-muted">
                    ราคาเดิม {formatTHB(r.original_baht)} − ลด {formatTHB(r.discount_baht)} = {formatTHB(r.final_baht)}
                  </p>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-3">
            <button
              onClick={() => { setRedemptionsFor(null); setRedemptions(null); }}
              className="text-[12px] text-muted hover:text-ink underline underline-offset-4 decoration-1"
            >
              ปิด ↺
            </button>
          </div>
        </Section>
      )}
    </Page>
  );
}
