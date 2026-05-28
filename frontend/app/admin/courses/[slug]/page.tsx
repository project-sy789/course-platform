"use client";
import { useEffect, useState, Fragment } from "react";
import Link from "next/link";
import { apiFetch, ApiError } from "@/lib/api";
import { adminApi } from "@/lib/admin";
import { formatTHB, formatBytes } from "@/lib/format";
import {
  Button, ErrorNote, Field, Input, Loading, Page, PageTitle, Pill, Section,
  TD, TH, THead, TR, Table,
} from "@/components/ui";
import { CourseCover } from "@/components/CourseCover";

type Lesson = {
  id: string;
  title: string;
  position: number;
  is_preview: boolean;
  price_baht?: number;
};

type CourseDetail = {
  id: string;
  slug: string;
  title: string;
  description?: string;
  price_baht: number;
  access_duration_days?: number | null;
  pixel_watermark?: boolean;
  is_featured?: boolean;
  cover_url?: string | null;
  lessons: Lesson[];
};

type EditForm = {
  title: string;
  is_preview: boolean;
  price_baht: number;
};

type Material = {
  id: string;
  filename: string;
  content_type: string;
  size_bytes: number;
  created_at?: string;
};

export default function AdminCourseDetailPage({ params }: { params: { slug: string } }) {
  const [course, setCourse] = useState<CourseDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<EditForm | null>(null);
  const [editBusy, setEditBusy] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  const [matsForLesson, setMatsForLesson] = useState<string | null>(null);
  const [mats, setMats] = useState<Material[]>([]);
  const [matsBusy, setMatsBusy] = useState(false);
  const [matsError, setMatsError] = useState<string | null>(null);

  const [courseMats, setCourseMats] = useState<Material[]>([]);
  const [courseMatsBusy, setCourseMatsBusy] = useState(false);
  const [courseMatsError, setCourseMatsError] = useState<string | null>(null);

  const [coverBusy, setCoverBusy] = useState(false);
  const [coverError, setCoverError] = useState<string | null>(null);

  const [featuredBusy, setFeaturedBusy] = useState(false);
  const [featuredError, setFeaturedError] = useState<string | null>(null);

  async function toggleFeatured() {
    if (!course) return;
    setFeaturedBusy(true); setFeaturedError(null);
    try {
      await adminApi.updateCourse(params.slug, { is_featured: !course.is_featured });
      await reload();
    } catch (e: any) { setFeaturedError(e.message); }
    finally { setFeaturedBusy(false); }
  }

  async function uploadCover(file: File | null) {
    if (!file) return;
    setCoverBusy(true); setCoverError(null);
    try {
      await adminApi.uploadCourseCover(params.slug, file);
      await reload();
    } catch (e: any) { setCoverError(e.message); }
    finally { setCoverBusy(false); }
  }

  async function removeCover() {
    if (!window.confirm("ลบรูปปกคอร์สนี้ ?")) return;
    setCoverBusy(true); setCoverError(null);
    try {
      await adminApi.deleteCourseCover(params.slug);
      await reload();
    } catch (e: any) { setCoverError(e.message); }
    finally { setCoverBusy(false); }
  }

  const reload = () =>
    apiFetch<CourseDetail>(`/api/v1/courses/${params.slug}`)
      .then(setCourse)
      .catch((e: ApiError) => setError(e?.message ?? "failed"));

  const reloadCourseMats = () =>
    adminApi.listCourseMaterials(params.slug)
      .then(setCourseMats)
      .catch((e: any) => setCourseMatsError(e.message));

  useEffect(() => { reload(); reloadCourseMats(); }, [params.slug]);

  async function uploadCourseMaterial(files: FileList | null) {
    if (!files || files.length === 0) return;
    setCourseMatsBusy(true); setCourseMatsError(null);
    try {
      for (const f of Array.from(files)) {
        await adminApi.uploadCourseMaterial(params.slug, f);
      }
      await reloadCourseMats();
    } catch (e: any) { setCourseMatsError(e.message); }
    finally { setCourseMatsBusy(false); }
  }

  async function removeCourseMaterial(id: string, filename: string) {
    if (!window.confirm(`ลบเอกสาร "${filename}" ?`)) return;
    try {
      await adminApi.deleteMaterial(id);
      await reloadCourseMats();
    } catch (e: any) { window.alert(e.message); }
  }

  function startEdit(l: Lesson) {
    setEditingId(l.id);
    setEditError(null);
    setEditForm({
      title: l.title,
      is_preview: l.is_preview,
      price_baht: l.price_baht ?? 0,
    });
  }

  function cancelEdit() {
    setEditingId(null);
    setEditForm(null);
    setEditError(null);
  }

  async function saveEdit(id: string) {
    if (!editForm) return;
    setEditBusy(true); setEditError(null);
    try {
      await adminApi.updateLesson(id, {
        title: editForm.title,
        is_preview: editForm.is_preview,
        price_baht: Number(editForm.price_baht) || 0,
      });
      await reload();
      cancelEdit();
    } catch (e: any) { setEditError(e.message); }
    finally { setEditBusy(false); }
  }

  async function move(id: string, delta: -1 | 1) {
    if (!course) return;
    const lesson = course.lessons.find((l) => l.id === id);
    if (!lesson) return;
    const target = lesson.position + delta;
    const max = Math.max(...course.lessons.map((l) => l.position));
    if (target < 1 || target > max) return;
    try {
      await adminApi.updateLesson(id, { position: target });
      await reload();
    } catch (e: any) { window.alert(e.message); }
  }

  async function remove(l: Lesson) {
    if (!window.confirm(`ลบบทเรียน "${l.title}" ?\n\nระบบจะปฏิเสธหากมีคนซื้อบทเรียนนี้แยกอยู่ — ต้องถอนสิทธิ์ก่อน`)) return;
    try {
      await adminApi.deleteLesson(l.id);
      await reload();
    } catch (e: any) { window.alert(e.message); }
  }

  async function openMaterials(lessonId: string) {
    setMatsForLesson(lessonId);
    setMatsError(null);
    setMats([]);
    try {
      const list = await adminApi.listMaterials(lessonId);
      setMats(list);
    } catch (e: any) { setMatsError(e.message); }
  }

  function closeMaterials() {
    setMatsForLesson(null);
    setMats([]);
    setMatsError(null);
  }

  async function uploadMaterial(lessonId: string, files: FileList | null) {
    if (!files || files.length === 0) return;
    setMatsBusy(true); setMatsError(null);
    try {
      for (const f of Array.from(files)) {
        await adminApi.uploadMaterial(lessonId, f);
      }
      const list = await adminApi.listMaterials(lessonId);
      setMats(list);
    } catch (e: any) { setMatsError(e.message); }
    finally { setMatsBusy(false); }
  }

  async function removeMaterial(lessonId: string, materialId: string, filename: string) {
    if (!window.confirm(`ลบเอกสาร "${filename}" ?`)) return;
    try {
      await adminApi.deleteMaterial(materialId);
      const list = await adminApi.listMaterials(lessonId);
      setMats(list);
    } catch (e: any) { window.alert(e.message); }
  }

  if (error) return <Page><ErrorNote>{error}</ErrorNote></Page>;
  if (!course) return <Page><Loading /></Page>;

  const sortedLessons = [...course.lessons].sort((a, b) => a.position - b.position);

  return (
    <Page>
      <div className="mb-2 text-[12px] uppercase tracking-[0.22em] text-muted">
        <Link href="/admin/courses" className="hover:text-ink underline underline-offset-4 decoration-1">
          ← คอร์สทั้งหมด
        </Link>
      </div>
      <PageTitle kicker={`Slug · ${course.slug}`}>{course.title}</PageTitle>

      <div className="border-y border-rule py-4 mb-10 grid grid-cols-2 sm:grid-cols-4 gap-6">
        <KV label="ราคา" value={course.price_baht === 0 ? "ฟรี" : formatTHB(course.price_baht)} />
        <KV label="ระยะเวลาเข้าถึง" value={course.access_duration_days == null ? "ตลอดชีพ" : `${course.access_duration_days} วัน`} />
        <KV label="ลายน้ำพิกเซล" value={course.pixel_watermark ? "เปิด" : "ปิด"} />
        <KV label="บทเรียน" value={`${course.lessons.length} บท`} />
      </div>

      <Section
        title="เด่นในหน้าแรก"
        hint="ติ๊กไว้เพื่อให้คอร์สนี้ปรากฏใน 'คอร์สแนะนำ — ฉบับเปิดเล่ม' ที่หมุนสลับบนหน้าแรก"
      >
        <div className="flex items-center gap-5 flex-wrap">
          <button
            onClick={toggleFeatured}
            disabled={featuredBusy}
            aria-pressed={!!course.is_featured}
            className={`inline-flex items-center gap-3 border-2 px-4 py-2 text-[12px] uppercase tracking-[0.18em] transition disabled:opacity-50 ${
              course.is_featured
                ? "border-oxblood bg-oxblood text-paper hover:bg-ink hover:border-ink"
                : "border-ink bg-paper text-ink hover:bg-ink hover:text-paper"
            }`}
          >
            <span className={`w-3 h-3 border ${course.is_featured ? "bg-paper border-paper" : "border-ink"}`} />
            {course.is_featured ? "อยู่ในเสาแนะนำ" : "เพิ่มเข้าเสาแนะนำ"}
          </button>
          <p className="text-[12px] text-muted italic max-w-prose">
            {course.is_featured
              ? "กดอีกครั้งเพื่อเอาออก — ระบบหมุนแสดงสูงสุด ๓ คอร์สที่ติ๊กล่าสุด"
              : "ถ้าไม่มีคอร์สใดถูกติ๊ก หน้าแรกจะใช้ ๓ คอร์สที่สร้างล่าสุดเป็นค่า fallback"}
          </p>
        </div>
        <ErrorNote>{featuredError}</ErrorNote>
      </Section>

      <Section
        title="รูปปกคอร์ส"
        hint="แสดงบนหน้าแรก, สารบัญ และหน้าคอร์ส — ถ้ายังไม่อัป จะใช้ปก generated อัตโนมัติ"
      >
        <div className="grid sm:grid-cols-[12rem_1fr] gap-6 items-start">
          <CourseCover
            slug={course.slug}
            title={course.title}
            variant="card"
            coverUrl={course.cover_url ? `${course.cover_url}?v=${Date.now()}` : null}
            className="w-48 aspect-[3/4] shadow-[0_1px_8px_rgba(28,24,20,0.10)]"
          />
          <div>
            <p className="text-[13px] text-muted leading-relaxed mb-4 max-w-prose">
              อัปโหลดไฟล์ JPG / PNG / WebP ขนาดไม่เกิน ๕ MB
              สัดส่วนแนะนำ ๓:๔ (เช่น 900×1200) — ระบบจะแสดงเต็มกรอบเสมอ
            </p>
            <div className="flex items-center gap-4 flex-wrap">
              <label className="inline-flex items-center gap-3 cursor-pointer">
                <span className="border-2 border-ink px-4 py-2 text-[12px] uppercase tracking-[0.18em] hover:bg-ink hover:text-paper transition">
                  {coverBusy ? "กำลังอัปโหลด…" : course.cover_url ? "เปลี่ยนรูปปก →" : "เลือกรูปปก →"}
                </span>
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  disabled={coverBusy}
                  onChange={(e) => {
                    uploadCover(e.target.files?.[0] ?? null);
                    e.target.value = "";
                  }}
                  className="sr-only"
                />
              </label>
              {course.cover_url && (
                <button
                  onClick={removeCover}
                  disabled={coverBusy}
                  className="text-[13px] text-oxblood hover:underline underline-offset-4 decoration-1 disabled:opacity-50"
                >
                  ลบรูปปก
                </button>
              )}
            </div>
            <ErrorNote>{coverError}</ErrorNote>
          </div>
        </div>
      </Section>

      <Section
        title="เอกสารระดับคอร์ส"
        hint="ใช้ร่วมกันทั้งคอร์ส — ผู้เรียนทุกคนที่ลงทะเบียนเห็น (ไม่ผูกกับบทเรียนใดบทหนึ่ง)"
      >
        {courseMats.length === 0 ? (
          <p className="text-[13px] text-muted italic mb-4">
            ยังไม่มีเอกสารระดับคอร์ส — เหมาะกับ syllabus, ใบงานสรุป, บรรณานุกรมที่ใช้ทั้งคอร์ส
          </p>
        ) : (
          <ul className="border-t border-rule mb-4">
            {courseMats.map((m) => (
              <li key={m.id} className="border-b border-rule grid grid-cols-[1fr_auto_auto] gap-4 py-2 items-baseline">
                <span className="font-display text-[14px]">{m.filename}</span>
                <span className="font-mono text-[11px] text-muted">
                  {m.content_type} · {formatBytes(m.size_bytes)}
                </span>
                <button
                  onClick={() => removeCourseMaterial(m.id, m.filename)}
                  className="text-[12px] text-oxblood hover:underline underline-offset-4 decoration-1"
                >
                  ลบ
                </button>
              </li>
            ))}
          </ul>
        )}

        <label className="inline-flex items-center gap-3 cursor-pointer">
          <span className="border-2 border-ink px-4 py-2 text-[12px] uppercase tracking-[0.18em] hover:bg-ink hover:text-paper transition">
            {courseMatsBusy ? "กำลังอัปโหลด…" : "เลือกไฟล์อัปโหลด →"}
          </span>
          <input
            type="file" multiple
            accept=".pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.txt,.zip,image/*"
            disabled={courseMatsBusy}
            onChange={(e) => {
              uploadCourseMaterial(e.target.files);
              e.target.value = "";
            }}
            className="sr-only"
          />
          <span className="text-[12px] text-muted italic">
            หลายไฟล์ในครั้งเดียวได้ · ไม่เกิน ๕๐ MB ต่อไฟล์
          </span>
        </label>
        <ErrorNote>{courseMatsError}</ErrorNote>
      </Section>

      <Section
        title="บทเรียน"
        hint="แก้ไขชื่อ · เปิด/ปิดตัวอย่าง · ตั้งราคาแยก · เรียงลำดับ · เอกสารแนบ · ลบ"
      >
        <div className="text-[12px] text-muted leading-relaxed mb-4 max-w-prose italic">
          การเพิ่มบทเรียนใหม่ใช้หน้า{" "}
          <Link href="/admin/upload" className="not-italic underline underline-offset-4 decoration-1 text-ink">
            อัปโหลดวิดีโอ
          </Link>
          {" "}— อัปโหลด HLS + คีย์ AES แล้วระบบจะเชื่อมเข้ากับคอร์สนี้ตามลำดับที่กำหนด
        </div>

        <Table>
          <THead>
            <TH className="w-12 text-right">#</TH>
            <TH>ชื่อบท</TH>
            <TH>ตัวอย่าง</TH>
            <TH>ราคาแยก</TH>
            <TH className="text-right">จัดการ</TH>
          </THead>
          <tbody>
            {sortedLessons.map((l, i) => {
              const isEditing = editingId === l.id;
              const isFirst = i === 0;
              const isLast = i === sortedLessons.length - 1;
              return (
                <Fragment key={l.id}>
                  <TR>
                    <TD className="text-right font-mono text-[12px] tabular-nums">
                      {String(l.position).padStart(2, "0")}
                    </TD>
                    <TD className="font-display text-[15px]">{l.title}</TD>
                    <TD>
                      {l.is_preview
                        ? <Pill tone="ok">ฟรี</Pill>
                        : <Pill tone="neutral">เฉพาะผู้ลงทะเบียน</Pill>}
                    </TD>
                    <TD className="font-mono text-[13px]">
                      {l.price_baht && l.price_baht > 0
                        ? formatTHB(l.price_baht)
                        : <span className="text-muted">—</span>}
                    </TD>
                    <TD className="text-right whitespace-nowrap">
                      {isEditing ? (
                        <button onClick={cancelEdit}
                          className="text-[12px] text-muted hover:text-ink underline underline-offset-4 decoration-1">
                          ยกเลิก
                        </button>
                      ) : (
                        <span className="inline-flex gap-x-3 items-baseline">
                          <button
                            onClick={() => move(l.id, -1)} disabled={isFirst}
                            aria-label="เลื่อนขึ้น"
                            className="font-mono text-[14px] text-muted hover:text-ink disabled:opacity-30 disabled:cursor-not-allowed"
                          >↑</button>
                          <button
                            onClick={() => move(l.id, +1)} disabled={isLast}
                            aria-label="เลื่อนลง"
                            className="font-mono text-[14px] text-muted hover:text-ink disabled:opacity-30 disabled:cursor-not-allowed"
                          >↓</button>
                          <button
                            onClick={() => matsForLesson === l.id ? closeMaterials() : openMaterials(l.id)}
                            className="text-[12px] text-ink hover:text-oxblood underline underline-offset-4 decoration-1"
                          >
                            เอกสาร
                          </button>
                          <button onClick={() => startEdit(l)}
                            className="text-[12px] text-ink hover:text-oxblood underline underline-offset-4 decoration-1">
                            แก้ไข
                          </button>
                          <button onClick={() => remove(l)}
                            className="text-[12px] text-oxblood hover:underline underline-offset-4 decoration-1">
                            ลบ
                          </button>
                        </span>
                      )}
                    </TD>
                  </TR>
                  {isEditing && editForm && (
                    <tr className="bg-cream/40">
                      <td colSpan={5} className="px-4 py-5">
                        <div className="grid sm:grid-cols-2 gap-x-6 gap-y-4 max-w-3xl">
                          <Field label="ชื่อบท">
                            <Input value={editForm.title}
                              onChange={(e) => setEditForm({ ...editForm, title: e.target.value })} />
                          </Field>
                          <Field label="ราคาแยก (บาท)" hint="0 = ขายเฉพาะผ่านคอร์ส">
                            <Input type="number" min={0} className="font-mono"
                              value={editForm.price_baht}
                              onChange={(e) => setEditForm({ ...editForm, price_baht: Number(e.target.value) })} />
                          </Field>
                          <label className="flex items-start gap-3 text-[14px] cursor-pointer pt-7 sm:col-span-2">
                            <input type="checkbox" checked={editForm.is_preview}
                              onChange={(e) => setEditForm({ ...editForm, is_preview: e.target.checked })}
                              className="mt-[5px] accent-oxblood w-4 h-4" />
                            <span>
                              <span className="font-display text-[15px]">เปิดเป็นตัวอย่าง</span>
                              <span className="block text-[12px] text-muted mt-1">
                                ผู้เยี่ยมชมที่ยังไม่สมัครก็ดูได้ — มักใช้กับบทแรกหรือบทแนะนำ
                              </span>
                            </span>
                          </label>
                        </div>
                        <ErrorNote>{editError}</ErrorNote>
                        <div className="flex gap-3 mt-4">
                          <Button disabled={editBusy} onClick={() => saveEdit(l.id)}>
                            {editBusy ? "…" : "บันทึก →"}
                          </Button>
                          <button onClick={cancelEdit}
                            className="text-[13px] text-muted hover:text-ink underline underline-offset-4 decoration-1">
                            ยกเลิก
                          </button>
                        </div>
                      </td>
                    </tr>
                  )}
                  {matsForLesson === l.id && (
                    <tr className="bg-cream/40">
                      <td colSpan={5} className="px-4 py-5">
                        <div className="flex items-baseline gap-4 mb-3">
                          <h3 className="font-display text-[16px]">เอกสารประกอบบทเรียน</h3>
                          <span className="grow border-t border-rule/40" />
                          <span className="font-mono text-[11px] text-muted">
                            {mats.length.toString().padStart(2, "0")} ไฟล์
                          </span>
                          <button onClick={closeMaterials}
                            className="text-[12px] text-muted hover:text-ink underline underline-offset-4 decoration-1">
                            ปิด
                          </button>
                        </div>

                        {mats.length === 0 ? (
                          <p className="text-[13px] text-muted italic mb-4">ยังไม่มีเอกสารแนบในบทนี้</p>
                        ) : (
                          <ul className="border-t border-rule mb-4">
                            {mats.map((m) => (
                              <li key={m.id} className="border-b border-rule grid grid-cols-[1fr_auto_auto] gap-4 py-2 items-baseline">
                                <span className="font-display text-[14px]">{m.filename}</span>
                                <span className="font-mono text-[11px] text-muted">
                                  {m.content_type} · {formatBytes(m.size_bytes)}
                                </span>
                                <button
                                  onClick={() => removeMaterial(l.id, m.id, m.filename)}
                                  className="text-[12px] text-oxblood hover:underline underline-offset-4 decoration-1"
                                >
                                  ลบ
                                </button>
                              </li>
                            ))}
                          </ul>
                        )}

                        <label className="inline-flex items-center gap-3 cursor-pointer">
                          <span className="border-2 border-ink px-4 py-2 text-[12px] uppercase tracking-[0.18em] hover:bg-ink hover:text-paper transition">
                            {matsBusy ? "กำลังอัปโหลด…" : "เลือกไฟล์อัปโหลด →"}
                          </span>
                          <input
                            type="file" multiple
                            accept=".pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.txt,.zip,image/*"
                            disabled={matsBusy}
                            onChange={(e) => {
                              uploadMaterial(l.id, e.target.files);
                              e.target.value = "";
                            }}
                            className="sr-only"
                          />
                          <span className="text-[12px] text-muted italic">
                            ขนาดไม่เกิน ๕๐ MB ต่อไฟล์ — รองรับ PDF, Office, รูปภาพ
                          </span>
                        </label>
                        <ErrorNote>{matsError}</ErrorNote>
                        <p className="mt-3 text-[12px] italic text-muted leading-snug max-w-prose">
                          ทุกการดาวน์โหลดของผู้ใช้จะฝังรหัสนิติวิทยาในไฟล์
                          (เช่น metadata ของ PDF) เพื่อระบุตัวเจ้าของบัญชีหากมีการเผยแพร่ต่อ
                        </p>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
            {sortedLessons.length === 0 && (
              <TR>
                <TD colSpan={5} className="text-muted italic text-center">
                  ยังไม่มีบทเรียน — ไป{" "}
                  <Link href="/admin/upload" className="underline underline-offset-4 decoration-1 text-ink">
                    หน้าอัปโหลดวิดีโอ
                  </Link>
                  {" "}เพื่อเริ่มเพิ่ม
                </TD>
              </TR>
            )}
          </tbody>
        </Table>
      </Section>
    </Page>
  );
}

function KV({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-[0.22em] text-muted mb-1">{label}</div>
      <div className="font-display text-[18px]">{value}</div>
    </div>
  );
}
