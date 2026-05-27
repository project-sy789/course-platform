"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ApiError, Device, listDevices, revokeAllDevices, revokeDevice,
} from "@/lib/api";
import { formatThaiDateTime } from "@/lib/format";
import {
  Button, ErrorNote, Loading, Page, PageTitle, Pill, Section,
} from "@/components/ui";

export default function DevicesPage() {
  const router = useRouter();
  const [devices, setDevices] = useState<Device[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [acting, setActing] = useState<string | null>(null);

  function load() {
    setError(null);
    listDevices()
      .then(setDevices)
      .catch((e: ApiError) => {
        if (e.status === 401) router.push("/login");
        else setError(e.message);
      });
  }
  useEffect(load, [router]);

  async function revokeOne(d: Device) {
    if (d.current) {
      if (!confirm("นี่คืออุปกรณ์ที่คุณกำลังใช้อยู่ การเพิกถอนจะทำให้ต้องล็อกอินใหม่ ดำเนินการต่อ?")) return;
    } else if (!confirm(`เพิกถอน ${d.label}?`)) return;

    setActing(d.id);
    try {
      await revokeDevice(d.id);
      if (d.current) { router.push("/login"); return; }
      load();
    } catch (e: any) {
      setError(e?.message ?? "เพิกถอนไม่สำเร็จ");
    } finally { setActing(null); }
  }

  async function revokeAll() {
    if (!confirm("เพิกถอนอุปกรณ์ทั้งหมดและออกจากระบบทุกที่? คุณจะต้องล็อกอินใหม่และยืนยัน OTP อีกครั้ง")) return;
    setActing("all");
    try {
      await revokeAllDevices();
      router.push("/login");
    } catch (e: any) {
      setError(e?.message ?? "ดำเนินการไม่สำเร็จ");
      setActing(null);
    }
  }

  return (
    <Page width="column">
      <Link href="/account" className="text-[13px] text-muted underline underline-offset-4 decoration-1 inline-block mb-4">
        ← บัญชีของฉัน
      </Link>
      <PageTitle kicker="ความปลอดภัยของบัญชี">อุปกรณ์ที่เชื่อถือ</PageTitle>
      <p className="text-[14px] text-muted leading-relaxed -mt-6 mb-2 max-w-prose">
        อุปกรณ์ในรายการนี้ได้ยืนยันตัวตนด้วย OTP แล้ว
        ระบบจะข้ามการขอ OTP ในการเข้าสู่ระบบครั้งถัดไป
        หากพบรายการที่ไม่รู้จัก ให้เพิกถอนทันที
      </p>

      <ErrorNote>{error}</ErrorNote>

      <Section title="รายการอุปกรณ์" hint="เรียงตามครั้งล่าสุดที่ใช้งาน">
        {!devices && <Loading />}
        {devices && devices.length === 0 && (
          <p className="text-muted italic">ยังไม่มีอุปกรณ์ที่เชื่อถือ</p>
        )}
        {devices && devices.length > 0 && (
          <ol className="border-t border-rule">
            {devices.map((d, i) => (
              <li key={d.id} className="border-b border-rule py-4 grid grid-cols-[2.5rem_1fr_auto] gap-4 items-baseline">
                <span className="font-mono text-[12px] text-muted tabular-nums">
                  {(i + 1).toString().padStart(2, "0")}
                </span>
                <div className="min-w-0">
                  <p className="font-display text-[18px] flex items-center gap-3">
                    <span className="truncate">{d.label}</span>
                    {d.current && <Pill tone="ok">อุปกรณ์นี้</Pill>}
                  </p>
                  <p className="text-[12px] text-muted mt-1">
                    เห็นล่าสุด {formatThaiDateTime(d.last_seen_at)}
                    {d.last_ip && <> จาก IP <span className="font-mono">{d.last_ip}</span></>}
                  </p>
                  <p className="text-[11px] text-muted/70 mt-0.5">
                    เพิ่มเมื่อ {formatThaiDateTime(d.created_at)}
                  </p>
                </div>
                <Button tone="ghost" onClick={() => revokeOne(d)} disabled={acting === d.id}>
                  เพิกถอน
                </Button>
              </li>
            ))}
          </ol>
        )}
      </Section>

      <Section
        tone="danger"
        title="หากสงสัยว่าบัญชีถูกขโมย"
        hint="กดเพื่อเพิกถอนอุปกรณ์ทุกเครื่องและตัดเซสชันทุกที่ในทันที — คุณจะต้องเข้าสู่ระบบและยืนยัน OTP ใหม่ทั้งหมด"
      >
        <Button tone="danger" onClick={revokeAll}
          disabled={acting === "all" || !devices?.length}>
          {acting === "all" ? "กำลังดำเนินการ…" : "ออกจากระบบทุกที่"}
        </Button>
      </Section>
    </Page>
  );
}
