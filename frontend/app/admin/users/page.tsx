"use client";
import { useEffect, useState } from "react";
import { adminApi, type AdminUser } from "@/lib/admin";
import { formatThaiDate } from "@/lib/format";
import {
  Button, ErrorNote, Field, Input, OkNote, Page, PageTitle, Pill,
  Section, TD, TH, THead, TR, Table,
} from "@/components/ui";

export default function AdminUsersPage() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [grant, setGrant] = useState({ user_email: "", course_slug: "" });
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    adminApi.users().then(setUsers).catch((e) => setError(e.message));
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null); setError(null);
    try {
      const r = await adminApi.grantEnrollment(grant.user_email, grant.course_slug);
      setMsg(`${r.status}: ${r.id}`);
    } catch (e: any) { setError(e.message); }
  }

  return (
    <Page>
      <PageTitle kicker="กองบรรณาธิการ">ผู้ใช้และการลงทะเบียน</PageTitle>

      <Section
        title="เปิดสิทธิ์เรียนด้วยตนเอง"
        hint="ใช้เมื่อรับโอนเงินนอกระบบ หรือเพื่อมอบสิทธิ์ทดลองให้นักเรียน"
      >
        <form onSubmit={submit} className="space-y-5 max-w-xl">
          <Field label="อีเมลผู้ใช้">
            <Input required type="email" value={grant.user_email}
              placeholder="user@example.com"
              onChange={(e) => setGrant({ ...grant, user_email: e.target.value })} />
          </Field>
          <Field label="Slug คอร์ส">
            <Input required value={grant.course_slug} className="font-mono"
              onChange={(e) => setGrant({ ...grant, course_slug: e.target.value })} />
          </Field>
          {msg && <OkNote>{msg}</OkNote>}
          <ErrorNote>{error}</ErrorNote>
          <Button>เปิดสิทธิ์ →</Button>
        </form>
      </Section>

      <Section title="ผู้ใช้ทั้งหมด" hint={`${users.length} บัญชีในระบบ`}>
        <Table>
          <THead>
            <TH>อีเมล</TH>
            <TH>บทบาท</TH>
            <TH>สถานะ</TH>
            <TH>วันที่สมัคร</TH>
          </THead>
          <tbody>
            {users.map((u) => (
              <TR key={u.id}>
                <TD className="font-display text-[15px]">{u.email}</TD>
                <TD>
                  {u.is_admin
                    ? <Pill tone="warn">ผู้ดูแล</Pill>
                    : <span className="text-muted">ผู้ใช้</span>}
                </TD>
                <TD>
                  {u.is_active
                    ? <Pill tone="ok">ใช้งานอยู่</Pill>
                    : <Pill tone="danger">ระงับ</Pill>}
                </TD>
                <TD className="text-muted font-mono text-[12px]">
                  {formatThaiDate(u.created_at)}
                </TD>
              </TR>
            ))}
            {users.length === 0 && (
              <TR>
                <TD colSpan={4} className="text-muted italic text-center">
                  ยังไม่มีผู้ใช้
                </TD>
              </TR>
            )}
          </tbody>
        </Table>
      </Section>
    </Page>
  );
}
