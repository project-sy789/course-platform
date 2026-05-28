"use client";
import { useCallback, useEffect, useState } from "react";
import {
  adminApi,
  type AdminUserDetail,
  type UserBrief,
} from "@/lib/admin";
import { formatNumber, formatTHB, formatThaiDate, formatThaiDateTime } from "@/lib/format";
import {
  Button, ErrorNote, Field, Input, OkNote, Page, PageTitle, Pill, Section,
  Select, TD, TH, THead, TR, Table,
} from "@/components/ui";

type StatusFilter = "" | "active" | "suspended" | "unverified";
type RoleFilter = "" | "admin" | "user";
type Sort = "created_desc" | "created_asc" | "email_asc";
type BulkAction = "suspend" | "activate" | "promote" | "demote" | "delete";

export default function AdminUsersPage() {
  const [rows, setRows] = useState<UserBrief[]>([]);
  const [total, setTotal] = useState(0);
  const [q, setQ] = useState("");
  const [role, setRole] = useState<RoleFilter>("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("");
  const [sort, setSort] = useState<Sort>("created_desc");
  const [offset, setOffset] = useState(0);
  const [limit] = useState(50);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [detailId, setDetailId] = useState<string | null>(null);
  const [bulkAction, setBulkAction] = useState<BulkAction>("suspend");

  const [grant, setGrant] = useState({ user_email: "", course_slug: "" });
  const [grantMsg, setGrantMsg] = useState<string | null>(null);
  const [grantErr, setGrantErr] = useState<string | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    try {
      const r = await adminApi.userSearch({
        q: q || undefined,
        role: role || undefined,
        status_filter: statusFilter || undefined,
        sort, limit, offset,
      });
      setRows(r.rows); setTotal(r.total); setError(null);
    } catch (e: any) { setError(e.message); }
  }, [q, role, statusFilter, sort, limit, offset]);

  useEffect(() => { reload(); }, [reload]);

  function toggle(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelected(next);
  }
  function toggleAll() {
    if (selected.size === rows.length) setSelected(new Set());
    else setSelected(new Set(rows.map((u) => u.id)));
  }

  async function doBulk() {
    if (selected.size === 0) return;
    const verbs: Record<BulkAction, string> = {
      suspend: "ระงับ", activate: "ปลดระงับ",
      promote: "แต่งตั้งแอดมิน", demote: "ถอดแอดมิน",
      delete: "ลบ",
    };
    if (!confirm(`${verbs[bulkAction]} ${selected.size} บัญชี?`)) return;
    setBusy(true); setError(null); setOk(null);
    try {
      const r = await adminApi.bulkUsers({
        user_ids: [...selected], action: bulkAction,
      });
      setOk(`ดำเนินการ ${verbs[bulkAction]} สำเร็จ ${r.affected} บัญชี`);
      setSelected(new Set());
      await reload();
    } catch (e: any) { setError(e.message); }
    finally { setBusy(false); }
  }

  async function doGrant(e: React.FormEvent) {
    e.preventDefault();
    setGrantErr(null); setGrantMsg(null);
    try {
      const r = await adminApi.grantEnrollment(grant.user_email, grant.course_slug);
      setGrantMsg(`${r.status}: ${r.id}`);
    } catch (e: any) { setGrantErr(e.message); }
  }

  return (
    <Page>
      <PageTitle kicker="กองบรรณาธิการ">ผู้ใช้และการลงทะเบียน</PageTitle>

      {/* Filters + search */}
      <section className="border-y border-rule py-4 my-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="grow min-w-[200px]">
            <label className="block text-[10px] uppercase tracking-[0.18em] text-muted mb-1">
              ค้นหาอีเมล
            </label>
            <Input
              placeholder="พิมพ์บางส่วนของอีเมล"
              value={q}
              onChange={(e) => { setQ(e.target.value); setOffset(0); }}
            />
          </div>
          <div>
            <label className="block text-[10px] uppercase tracking-[0.18em] text-muted mb-1">บทบาท</label>
            <Select value={role} onChange={(e) => { setRole(e.target.value as RoleFilter); setOffset(0); }}>
              <option value="">ทั้งหมด</option>
              <option value="admin">แอดมิน</option>
              <option value="user">ผู้ใช้ทั่วไป</option>
            </Select>
          </div>
          <div>
            <label className="block text-[10px] uppercase tracking-[0.18em] text-muted mb-1">สถานะ</label>
            <Select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value as StatusFilter); setOffset(0); }}>
              <option value="">ทั้งหมด</option>
              <option value="active">ใช้งาน</option>
              <option value="suspended">ถูกระงับ</option>
              <option value="unverified">ยังไม่ยืนยันอีเมล</option>
            </Select>
          </div>
          <div>
            <label className="block text-[10px] uppercase tracking-[0.18em] text-muted mb-1">เรียง</label>
            <Select value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
              <option value="created_desc">ใหม่ → เก่า</option>
              <option value="created_asc">เก่า → ใหม่</option>
              <option value="email_asc">อีเมล ก → z</option>
            </Select>
          </div>
          <a
            href={adminApi.usersCsvUrl()}
            className="border border-ink/60 px-3 py-2 text-[13px] uppercase tracking-[0.14em] hover:bg-ink hover:text-paper transition-colors"
            download
          >
            CSV
          </a>
        </div>
      </section>

      {/* Bulk actions */}
      {selected.size > 0 && (
        <section className="flex flex-wrap items-center gap-3 mb-3 bg-ink/[0.04] border border-rule px-3 py-2">
          <span className="text-[13px]">เลือก {formatNumber(selected.size)} บัญชี</span>
          <Select value={bulkAction} onChange={(e) => setBulkAction(e.target.value as BulkAction)}>
            <option value="suspend">ระงับ</option>
            <option value="activate">ปลดระงับ</option>
            <option value="promote">แต่งตั้งแอดมิน</option>
            <option value="demote">ถอดแอดมิน</option>
            <option value="delete">ลบ</option>
          </Select>
          <Button onClick={doBulk} disabled={busy}>ดำเนินการ</Button>
          <button
            type="button"
            onClick={() => setSelected(new Set())}
            className="text-[12px] text-muted hover:text-ink"
          >
            ล้างการเลือก
          </button>
        </section>
      )}

      {ok && <OkNote>{ok}</OkNote>}
      <ErrorNote>{error}</ErrorNote>

      <Table>
        <THead>
          <TH className="w-8">
            <input
              type="checkbox"
              checked={rows.length > 0 && selected.size === rows.length}
              onChange={toggleAll}
            />
          </TH>
          <TH>อีเมล</TH>
          <TH>บทบาท</TH>
          <TH>สถานะ</TH>
          <TH>ยืนยันเมล</TH>
          <TH>สมัครเมื่อ</TH>
          <TH className="w-24">{""}</TH>
        </THead>
        <tbody>
          {rows.map((u) => (
            <TR key={u.id}>
              <TD>
                <input
                  type="checkbox"
                  checked={selected.has(u.id)}
                  onChange={() => toggle(u.id)}
                />
              </TD>
              <TD className="font-display text-[15px]">{u.email}</TD>
              <TD>{u.is_admin
                ? <Pill tone="warn">ผู้ดูแล</Pill>
                : <span className="text-muted">ผู้ใช้</span>}
              </TD>
              <TD>{u.is_active
                ? <Pill tone="ok">ใช้งาน</Pill>
                : <Pill tone="danger">ระงับ</Pill>}
              </TD>
              <TD>{u.email_verified
                ? <span className="text-muted text-[12px]">✓</span>
                : <Pill>รอยืนยัน</Pill>}
              </TD>
              <TD className="text-muted font-mono text-[12px]">{formatThaiDate(u.created_at)}</TD>
              <TD>
                <button
                  onClick={() => setDetailId(u.id)}
                  className="text-[12px] underline underline-offset-4 hover:text-oxblood"
                >
                  เปิดดู
                </button>
              </TD>
            </TR>
          ))}
          {rows.length === 0 && (
            <TR>
              <TD colSpan={7} className="text-muted italic text-center">ไม่พบบัญชีที่ตรงกับเงื่อนไข</TD>
            </TR>
          )}
        </tbody>
      </Table>

      {/* Pagination */}
      <div className="flex items-center justify-between mt-4 text-[12px] text-muted font-mono">
        <span>{formatNumber(offset + 1)}–{formatNumber(Math.min(offset + rows.length, total))} จาก {formatNumber(total)}</span>
        <span className="flex gap-2">
          <Button
            tone="ghost"
            disabled={offset === 0}
            onClick={() => setOffset(Math.max(0, offset - limit))}
          >
            ← ก่อนหน้า
          </Button>
          <Button
            tone="ghost"
            disabled={offset + limit >= total}
            onClick={() => setOffset(offset + limit)}
          >
            ถัดไป →
          </Button>
        </span>
      </div>

      {/* Manual grant tool — kept from old page */}
      <Section
        title="เปิดสิทธิ์เรียนด้วยตนเอง"
        hint="ใช้เมื่อรับโอนเงินนอกระบบ หรือเพื่อมอบสิทธิ์ทดลองให้นักเรียน"
      >
        <form onSubmit={doGrant} className="space-y-5 max-w-xl">
          <Field label="อีเมลผู้ใช้">
            <Input required type="email" value={grant.user_email}
              placeholder="user@example.com"
              onChange={(e) => setGrant({ ...grant, user_email: e.target.value })} />
          </Field>
          <Field label="Slug คอร์ส">
            <Input required value={grant.course_slug} className="font-mono"
              onChange={(e) => setGrant({ ...grant, course_slug: e.target.value })} />
          </Field>
          {grantMsg && <OkNote>{grantMsg}</OkNote>}
          <ErrorNote>{grantErr}</ErrorNote>
          <Button>เปิดสิทธิ์ →</Button>
        </form>
      </Section>

      {detailId && (
        <UserDetailDrawer
          userId={detailId}
          onClose={() => setDetailId(null)}
          onChanged={reload}
        />
      )}
    </Page>
  );
}

function UserDetailDrawer({
  userId, onClose, onChanged,
}: {
  userId: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [d, setD] = useState<AdminUserDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    adminApi.userDetail(userId).then(setD).catch((e) => setError(e.message));
  }, [userId]);
  useEffect(() => { load(); }, [load]);

  async function act(fn: () => Promise<unknown>, label: string) {
    setBusy(true); setError(null); setMsg(null);
    try { await fn(); setMsg(`${label} สำเร็จ`); load(); onChanged(); }
    catch (e: any) { setError(e.message); }
    finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button
        type="button"
        aria-label="ปิด"
        className="absolute inset-0 bg-ink/30"
        onClick={onClose}
      />
      <div className="relative bg-paper w-full max-w-2xl h-full overflow-y-auto border-l border-rule">
        <div className="sticky top-0 z-10 bg-paper border-b border-rule px-6 py-4 flex items-center justify-between">
          <div>
            <div className="text-[10px] uppercase tracking-[0.2em] text-muted">รายละเอียดบัญชี</div>
            <div className="font-display text-xl">{d?.user.email ?? "…"}</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-[20px] text-muted hover:text-ink leading-none"
          >×</button>
        </div>

        <div className="px-6 py-6 space-y-8">
          {error && <ErrorNote>{error}</ErrorNote>}
          {msg && <OkNote>{msg}</OkNote>}

          {!d ? (
            <p className="text-muted italic">กำลังโหลด…</p>
          ) : (
            <>
              <section>
                <div className="flex flex-wrap gap-2">
                  {d.user.is_admin
                    ? <Pill tone="warn">ผู้ดูแล</Pill>
                    : <Pill>ผู้ใช้</Pill>}
                  {d.user.is_active
                    ? <Pill tone="ok">ใช้งาน</Pill>
                    : <Pill tone="danger">ระงับ</Pill>}
                  {d.user.email_verified
                    ? <Pill tone="ok">ยืนยันอีเมลแล้ว</Pill>
                    : <Pill>รอยืนยันอีเมล</Pill>}
                </div>
                <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 text-[13px]">
                  <span className="text-muted">สมัครเมื่อ</span>
                  <span className="font-mono">{formatThaiDateTime(d.user.created_at)}</span>
                  {d.user.tax_name && (<>
                    <span className="text-muted">ใบกำกับภาษี</span>
                    <span>{d.user.tax_name}</span>
                  </>)}
                  {d.user.tax_id && (<>
                    <span className="text-muted">เลขผู้เสียภาษี</span>
                    <span className="font-mono">{d.user.tax_id}</span>
                  </>)}
                </div>
              </section>

              <section className="flex flex-wrap gap-2">
                <Button
                  disabled={busy}
                  onClick={() => act(
                    () => adminApi.patchUser(d.user.id, { is_active: !d.user.is_active }),
                    d.user.is_active ? "ระงับบัญชี" : "ปลดระงับ",
                  )}
                >
                  {d.user.is_active ? "ระงับบัญชี" : "ปลดระงับ"}
                </Button>
                <Button
                  disabled={busy}
                  onClick={() => act(
                    () => adminApi.patchUser(d.user.id, { is_admin: !d.user.is_admin }),
                    d.user.is_admin ? "ถอดแอดมิน" : "แต่งตั้งแอดมิน",
                  )}
                >
                  {d.user.is_admin ? "ถอดแอดมิน" : "แต่งตั้งแอดมิน"}
                </Button>
                <Button
                  disabled={busy}
                  onClick={() => act(
                    () => adminApi.revokeDevices(d.user.id),
                    "บังคับ logout",
                  )}
                >
                  บังคับ logout ทุกอุปกรณ์
                </Button>
                <Button
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true); setError(null); setMsg(null);
                    try {
                      const r = await adminApi.resetPassword(d.user.id);
                      try { await navigator.clipboard.writeText(r.reset_url); } catch { /* ignore */ }
                      setMsg(`คัดลอกลิงก์รีเซตแล้ว (อายุ ${r.ttl_minutes} นาที)`);
                    } catch (e: any) { setError(e.message); }
                    finally { setBusy(false); }
                  }}
                >
                  ออกลิงก์รีเซตรหัส
                </Button>
                <Button
                  tone="danger"
                  disabled={busy}
                  onClick={() => {
                    if (!confirm(`ลบบัญชี ${d.user.email}? การลบนี้กู้คืนไม่ได้`)) return;
                    act(async () => {
                      await adminApi.deleteUser(d.user.id);
                      onClose();
                    }, "ลบบัญชี");
                  }}
                >
                  ลบบัญชี
                </Button>
              </section>

              <DetailBlock title={`การลงทะเบียน · ${formatNumber(d.enrollments.length)}`}>
                {d.enrollments.length === 0
                  ? <p className="text-muted italic text-[13px]">ยังไม่มี</p>
                  : <ul className="text-[13px] divide-y divide-rule/40">
                      {d.enrollments.map((e) => (
                        <li key={e.id} className="py-2 flex justify-between gap-3">
                          <span>{e.course_title} <span className="font-mono text-muted">({e.course_slug})</span></span>
                          <span className="text-muted font-mono text-[12px]">
                            {e.expires_at ? `หมดอายุ ${formatThaiDate(e.expires_at)}` : "ไม่หมดอายุ"}
                          </span>
                        </li>
                      ))}
                    </ul>}
              </DetailBlock>

              <DetailBlock title={`การชำระเงิน · ${formatNumber(d.payments.length)}`}>
                {d.payments.length === 0
                  ? <p className="text-muted italic text-[13px]">ยังไม่มี</p>
                  : <ul className="text-[13px] divide-y divide-rule/40 font-mono">
                      {d.payments.map((p) => (
                        <li key={p.id} className="py-2 flex justify-between gap-3">
                          <span>{p.invoice_number || p.id.slice(0, 8)} · <Pill tone={p.status === "paid" ? "ok" : "neutral"}>{p.status}</Pill></span>
                          <span>{formatTHB(p.amount_baht)} <span className="text-muted">· {formatThaiDate(p.created_at)}</span></span>
                        </li>
                      ))}
                    </ul>}
              </DetailBlock>

              <DetailBlock title={`อุปกรณ์ที่เชื่อถือ · ${formatNumber(d.devices.length)}`}>
                {d.devices.length === 0
                  ? <p className="text-muted italic text-[13px]">ยังไม่มี</p>
                  : <ul className="text-[13px] divide-y divide-rule/40">
                      {d.devices.map((dv) => (
                        <li key={dv.id} className="py-2 flex justify-between gap-3">
                          <span>{dv.label || "(ไม่มีชื่อ)"}</span>
                          <span className="text-muted font-mono text-[12px]">
                            {dv.last_ip ?? "—"} · {dv.last_seen_at ? formatThaiDateTime(dv.last_seen_at) : "—"}
                          </span>
                        </li>
                      ))}
                    </ul>}
              </DetailBlock>

              <DetailBlock title={`การเข้าระบบล่าสุด · ${formatNumber(d.logins.length)}`}>
                {d.logins.length === 0
                  ? <p className="text-muted italic text-[13px]">ยังไม่มี</p>
                  : <ul className="text-[13px] divide-y divide-rule/40">
                      {d.logins.map((l) => (
                        <li key={l.id} className="py-2 flex justify-between gap-3">
                          <span>
                            <Pill tone={l.suspicious ? "danger" : l.status === "success" ? "ok" : "warn"}>
                              {l.status}{l.suspicious ? " · 🚩" : ""}
                            </Pill>
                          </span>
                          <span className="text-muted font-mono text-[12px]">
                            {l.ip ?? "—"} · {formatThaiDateTime(l.created_at)}
                          </span>
                        </li>
                      ))}
                    </ul>}
              </DetailBlock>

              <DetailBlock title={`สลิปที่อัปโหลด · ${formatNumber(d.slips.length)}`}>
                {d.slips.length === 0
                  ? <p className="text-muted italic text-[13px]">ยังไม่มี</p>
                  : <ul className="text-[13px] divide-y divide-rule/40">
                      {d.slips.map((s) => (
                        <li key={s.id} className="py-2 flex justify-between gap-3">
                          <span><Pill tone={s.status === "approved" ? "ok" : s.status === "rejected" ? "danger" : "warn"}>{s.status}</Pill></span>
                          <span className="font-mono text-[12px]">{formatTHB(s.amount_baht)} · {formatThaiDate(s.created_at)}</span>
                        </li>
                      ))}
                    </ul>}
              </DetailBlock>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function DetailBlock({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <div className="flex items-baseline gap-3 mb-2">
        <h3 className="font-display text-lg">{title}</h3>
        <span className="grow border-t border-rule/40" />
      </div>
      {children}
    </section>
  );
}
