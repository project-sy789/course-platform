"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ApiError, Device, listDevices, revokeAllDevices, revokeDevice,
} from "@/lib/api";
import { formatThaiDateTime } from "@/lib/format";

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
      if (!confirm(
        "นี่คืออุปกรณ์ที่คุณกำลังใช้อยู่ การเพิกถอนจะทำให้ต้องล็อกอินใหม่ ดำเนินการต่อ?"
      )) return;
    } else if (!confirm(`เพิกถอน ${d.label}?`)) return;

    setActing(d.id);
    try {
      await revokeDevice(d.id);
      if (d.current) {
        // Revoking just the trust row doesn't kill the JWT, so the user
        // is still logged in on this browser. Force them out via /logout-ish:
        // simplest is reload — next API call will get a 401 once they hit
        // an OTP-gated path. Most users won't trip that, so we redirect to
        // login explicitly to make the intent clear.
        router.push("/login");
        return;
      }
      load();
    } catch (e: any) {
      setError(e?.message ?? "เพิกถอนไม่สำเร็จ");
    } finally {
      setActing(null);
    }
  }

  async function revokeAll() {
    if (!confirm(
      "เพิกถอนอุปกรณ์ทั้งหมดและออกจากระบบทุกที่? " +
      "คุณจะต้องล็อกอินใหม่และยืนยัน OTP อีกครั้ง"
    )) return;
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
    <main className="max-w-2xl mx-auto p-8 space-y-4">
      <Link href="/account" className="text-sm underline opacity-70">← บัญชีของฉัน</Link>
      <header>
        <h1 className="text-2xl font-semibold">อุปกรณ์ที่เชื่อถือ</h1>
        <p className="opacity-70 mt-1 text-sm">
          อุปกรณ์เหล่านี้ได้ยืนยันตัวด้วย OTP แล้ว
          ระบบจะข้ามการขอ OTP ในการล็อกอินครั้งถัดไปจากอุปกรณ์เดียวกัน
          ถ้าเห็นอุปกรณ์ที่ไม่รู้จัก ให้กดเพิกถอนทันที
        </p>
      </header>

      {error && <p className="text-sm text-red-400">{error}</p>}

      {!devices && <p className="opacity-60">กำลังโหลด…</p>}
      {devices && devices.length === 0 && (
        <p className="opacity-50 text-sm">ยังไม่มีอุปกรณ์ที่เชื่อถือ</p>
      )}
      {devices && devices.length > 0 && (
        <ul className="space-y-2">
          {devices.map((d) => (
            <li
              key={d.id}
              className={
                "rounded-xl border p-4 flex items-center justify-between gap-3 " +
                (d.current
                  ? "border-emerald-700 bg-emerald-950/20"
                  : "border-neutral-800")
              }
            >
              <div className="min-w-0">
                <p className="font-medium truncate">
                  {d.label}
                  {d.current && (
                    <span className="ml-2 text-xs bg-emerald-700 text-emerald-50 rounded px-2 py-0.5">
                      อุปกรณ์นี้
                    </span>
                  )}
                </p>
                <p className="text-xs opacity-60">
                  เห็นล่าสุด {formatThaiDateTime(d.last_seen_at)}
                  {d.last_ip && <> จาก IP {d.last_ip}</>}
                </p>
                <p className="text-xs opacity-40">
                  เพิ่มเมื่อ {formatThaiDateTime(d.created_at)}
                </p>
              </div>
              <button
                onClick={() => revokeOne(d)}
                disabled={acting === d.id}
                className="text-sm rounded-md border border-red-700 text-red-300 px-3 py-1.5 disabled:opacity-50 whitespace-nowrap"
              >
                เพิกถอน
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="rounded-xl border border-red-900 bg-red-950/20 p-4 mt-6">
        <h2 className="font-medium text-red-200">หากสงสัยว่าบัญชีถูกขโมย</h2>
        <p className="text-sm opacity-80 mt-1">
          ปุ่มนี้จะ <b>เพิกถอนอุปกรณ์ทั้งหมด</b> และ <b>ตัดเซสชันทุกที่</b> ในทันที
          คุณจะต้องล็อกอินใหม่และยืนยัน OTP อีกครั้ง
        </p>
        <button
          onClick={revokeAll}
          disabled={acting === "all" || !devices?.length}
          className="mt-3 rounded-md bg-red-700 hover:bg-red-600 text-white text-sm font-medium px-4 py-2 disabled:opacity-50"
        >
          {acting === "all" ? "กำลังดำเนินการ…" : "ออกจากระบบทุกอุปกรณ์"}
        </button>
      </div>
    </main>
  );
}
