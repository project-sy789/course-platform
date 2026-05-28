"use client";
import { useCallback, useEffect, useState } from "react";
import { adminApi, VideoHealth } from "@/lib/admin";
import { formatNumber } from "@/lib/format";
import {
  Button, ErrorNote, KeyValue, Loading, Page, PageTitle, Pill,
  Section, StatusDot, Table, TD, TH, THead, TR,
} from "@/components/ui";

function thaiHourLabel(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:00`;
}

function MultiBarSparkline({
  rows, fields, height = 60,
}: {
  rows: { hour: string }[] & Record<string, number>[];
  fields: { key: string; color: string; label: string }[];
  height?: number;
}) {
  const w = 480;
  const barW = w / rows.length;
  const max = Math.max(
    1,
    ...rows.map((r) => fields.reduce((s, f) => s + ((r as any)[f.key] || 0), 0)),
  );
  return (
    <div>
      <svg viewBox={`0 0 ${w} ${height}`} className="w-full max-w-2xl border-l border-b border-rule/40">
        {rows.map((r, i) => {
          let yOff = 0;
          return (
            <g key={i} transform={`translate(${i * barW}, 0)`}>
              {fields.map((f) => {
                const v = (r as any)[f.key] || 0;
                const h = (v / max) * (height - 2);
                const y = height - yOff - h;
                yOff += h;
                return (
                  <rect key={f.key} x={1} y={y} width={Math.max(barW - 2, 1)}
                    height={Math.max(h, 0)} fill={f.color}>
                    <title>{`${thaiHourLabel(r.hour)} · ${f.label}: ${v}`}</title>
                  </rect>
                );
              })}
            </g>
          );
        })}
      </svg>
      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-[11px] text-muted">
        {fields.map((f) => (
          <span key={f.key} className="inline-flex items-center gap-1.5">
            <span className="inline-block w-2.5 h-2.5" style={{ background: f.color }} />
            {f.label}
          </span>
        ))}
        <span className="ml-auto font-mono">
          {thaiHourLabel(rows[0]!.hour)} → {thaiHourLabel(rows[rows.length - 1]!.hour)}
        </span>
      </div>
    </div>
  );
}

function StatCard({
  label, value, hint, tone,
}: {
  label: string; value: string | number;
  hint?: string; tone?: "ok" | "warn" | "danger" | "neutral";
}) {
  const ring = tone === "danger" ? "border-oxblood/60"
    : tone === "warn" ? "border-amber-600/60"
    : tone === "ok" ? "border-emerald-700/40"
    : "border-rule";
  return (
    <div className={`border ${ring} p-4`}>
      <div className="text-[11px] uppercase tracking-[0.18em] text-muted">{label}</div>
      <div className="font-display text-3xl mt-1">{typeof value === "number" ? formatNumber(value) : value}</div>
      {hint && <div className="text-[12px] text-muted mt-1">{hint}</div>}
    </div>
  );
}

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return "เพิ่งกี้";
  if (ms < 3600_000) return `${Math.floor(ms / 60_000)} นาทีก่อน`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3600_000)} ชม.ก่อน`;
  return `${Math.floor(ms / 86_400_000)} วันก่อน`;
}

export default function AdminVideoHealthPage() {
  const [data, setData] = useState<VideoHealth | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [autorefresh, setAutorefresh] = useState(true);

  const load = useCallback(async () => {
    setBusy(true); setErr(null);
    try {
      setData(await adminApi.videoHealth());
    } catch (e: any) {
      setErr(e?.message ?? "load failed");
    } finally { setBusy(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!autorefresh) return;
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, [autorefresh, load]);

  if (err && !data) return <Page><ErrorNote>{err}</ErrorNote></Page>;
  if (!data) return <Page><Loading /></Page>;

  const enc = data.encode.last_24h;
  const denyRate = data.playback.grants_24h + data.playback.denies_24h > 0
    ? data.playback.denies_24h / (data.playback.grants_24h + data.playback.denies_24h)
    : 0;
  const denyTone: "ok" | "warn" | "danger" =
    denyRate > 0.2 ? "danger" : denyRate > 0.05 ? "warn" : "ok";
  const failedTone: "ok" | "warn" | "danger" =
    enc.failed > 3 ? "danger" : enc.failed > 0 ? "warn" : "ok";
  const suspiciousCount =
    data.suspicious.multi_user_ips.length + data.suspicious.multi_ip_users.length;

  return (
    <Page>
      <PageTitle kicker="ห้องเครื่อง — สุขภาพวิดีโอ">
        สถานะวิดีโอ ๒๔ ชั่วโมงล่าสุด
      </PageTitle>

      <div className="-mt-4 mb-6 flex items-center gap-3 text-[12px] text-muted">
        <span>อัปเดต: {relativeTime(data.generated_at)}</span>
        <span aria-hidden>·</span>
        <label className="inline-flex items-center gap-1.5 cursor-pointer">
          <input
            type="checkbox"
            checked={autorefresh}
            onChange={(e) => setAutorefresh(e.target.checked)}
          />
          รีเฟรชอัตโนมัติทุก ๓๐ วินาที
        </label>
        <span className="grow" />
        <Button tone="ghost" onClick={load} disabled={busy}>
          {busy ? "…" : "รีเฟรช"}
        </Button>
      </div>

      {err && <ErrorNote>{err}</ErrorNote>}

      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-10">
        <StatCard label="encode สำเร็จ ๒๔ ชม." value={enc.done} tone="ok" />
        <StatCard label="encode ล้มเหลว ๒๔ ชม." value={enc.failed} tone={failedTone} />
        <StatCard
          label="ปฏิเสธคีย์ ๒๔ ชม."
          value={data.playback.denies_24h}
          hint={`${(denyRate * 100).toFixed(1)}% ของทั้งหมด`}
          tone={denyTone}
        />
        <StatCard
          label="เซสชันสด"
          value={data.sessions.total_active}
          hint={`สูงสุด ${data.sessions.max_per_user}/ผู้ใช้`}
          tone={data.sessions.near_max.length > 0 ? "warn" : "neutral"}
        />
      </div>

      <Section title="Encode pipeline" hint="งานคิว ffmpeg ๒๔ ชม.ล่าสุด แยกตามสถานะ">
        <div className="grid sm:grid-cols-4 gap-3 mb-6 text-center">
          <Pill tone="neutral">queued · {enc.pending}</Pill>
          <Pill tone="warn">running · {enc.running}</Pill>
          <Pill tone="ok">done · {enc.done}</Pill>
          <Pill tone={enc.failed > 0 ? "danger" : "neutral"}>failed · {enc.failed}</Pill>
        </div>

        <MultiBarSparkline
          rows={data.encode.sparkline_24h as any}
          fields={[
            { key: "done", color: "#15803d", label: "done" },
            { key: "running", color: "#d97706", label: "running" },
            { key: "pending", color: "#94a3b8", label: "queued" },
            { key: "failed", color: "#7f1d1d", label: "failed" },
          ]}
        />

        {data.encode.recent_failed.length > 0 && (
          <div className="mt-8">
            <p className="text-[12px] uppercase tracking-[0.18em] text-muted mb-3">
              งาน fail ล่าสุด
            </p>
            <Table>
              <THead>
                <TH>คอร์ส</TH>
                <TH>บทเรียน</TH>
                <TH>error</TH>
                <TH>เมื่อ</TH>
              </THead>
              {data.encode.recent_failed.map((j) => (
                <TR key={j.id}>
                  <TD className="font-mono text-[12px]">{j.course_slug}</TD>
                  <TD>{j.lesson_title}</TD>
                  <TD className="font-mono text-[11px] text-oxblood max-w-md truncate" title={j.error}>
                    {j.error || "—"}
                  </TD>
                  <TD className="text-[12px] text-muted">{relativeTime(j.updated_at)}</TD>
                </TR>
              ))}
            </Table>
          </div>
        )}

        {data.encode.recent_done.length > 0 && (
          <div className="mt-6">
            <p className="text-[12px] uppercase tracking-[0.18em] text-muted mb-3">
              งาน done ล่าสุด (เวลาที่ใช้ encode)
            </p>
            <Table>
              <THead>
                <TH>คอร์ส</TH>
                <TH>บทเรียน</TH>
                <TH>ใช้เวลา</TH>
                <TH>เมื่อ</TH>
              </THead>
              {data.encode.recent_done.map((j) => (
                <TR key={j.id}>
                  <TD className="font-mono text-[12px]">{j.course_slug}</TD>
                  <TD>{j.lesson_title}</TD>
                  <TD className="font-mono">{Math.floor(j.duration_sec / 60)}m {j.duration_sec % 60}s</TD>
                  <TD className="text-[12px] text-muted">{relativeTime(j.updated_at)}</TD>
                </TR>
              ))}
            </Table>
          </div>
        )}
      </Section>

      <Section
        title="Playback key access"
        hint="ทุกครั้งที่ player ขอ AES key — granted/denied พร้อมเหตุผล"
      >
        <div className="flex gap-6 items-baseline mb-6">
          <div>
            <span className="text-[11px] uppercase tracking-[0.18em] text-muted">granted</span>
            <span className="font-display text-2xl ml-3">{formatNumber(data.playback.grants_24h)}</span>
          </div>
          <div>
            <span className="text-[11px] uppercase tracking-[0.18em] text-muted">denied</span>
            <span className="font-display text-2xl ml-3 text-oxblood">{formatNumber(data.playback.denies_24h)}</span>
          </div>
          <div className="ml-auto">
            <Pill tone={denyTone}>
              deny rate · {(denyRate * 100).toFixed(1)}%
            </Pill>
          </div>
        </div>

        <MultiBarSparkline
          rows={data.playback.sparkline_24h as any}
          fields={[
            { key: "granted", color: "#15803d", label: "granted" },
            { key: "denied", color: "#7f1d1d", label: "denied" },
          ]}
        />

        {data.playback.deny_reasons.length > 0 && (
          <div className="mt-8">
            <p className="text-[12px] uppercase tracking-[0.18em] text-muted mb-3">
              เหตุผลที่ปฏิเสธคีย์ (Top 10)
            </p>
            <Table>
              <THead>
                <TH>เหตุผล</TH>
                <TH className="text-right">จำนวน</TH>
              </THead>
              {data.playback.deny_reasons.map((r) => (
                <TR key={r.reason}>
                  <TD className="font-mono text-[12px]">{r.reason}</TD>
                  <TD className="text-right font-mono">{formatNumber(r.count)}</TD>
                </TR>
              ))}
            </Table>
          </div>
        )}
      </Section>

      <Section
        title="รูปแบบที่น่าสงสัย"
        hint={`IP ที่ใช้ ≥${data.suspicious.thresholds.users_per_ip} บัญชี หรือ ผู้ใช้ที่กระโดด IP ≥${data.suspicious.thresholds.ips_per_user} ที่ใน ๒๔ ชม.`}
      >
        {suspiciousCount === 0 ? (
          <p className="text-muted italic">ไม่มีรูปแบบน่าสงสัยใน ๒๔ ชม.ที่ผ่านมา</p>
        ) : (
          <div className="grid lg:grid-cols-2 gap-8">
            <div>
              <p className="text-[12px] uppercase tracking-[0.18em] text-muted mb-3">
                IP เดียว → ผู้ใช้หลายคน
              </p>
              {data.suspicious.multi_user_ips.length === 0 ? (
                <p className="text-muted italic text-[13px]">—</p>
              ) : (
                <Table>
                  <THead>
                    <TH>IP</TH>
                    <TH className="text-right">บัญชี</TH>
                    <TH className="text-right">ครั้ง</TH>
                  </THead>
                  {data.suspicious.multi_user_ips.map((r, i) => (
                    <TR key={`${r.ip}-${i}`}>
                      <TD className="font-mono text-[12px]">{r.ip ?? "—"}</TD>
                      <TD className="text-right font-mono">{r.user_count}</TD>
                      <TD className="text-right font-mono text-muted">{r.request_count}</TD>
                    </TR>
                  ))}
                </Table>
              )}
            </div>

            <div>
              <p className="text-[12px] uppercase tracking-[0.18em] text-muted mb-3">
                ผู้ใช้เดียว → IP หลายที่
              </p>
              {data.suspicious.multi_ip_users.length === 0 ? (
                <p className="text-muted italic text-[13px]">—</p>
              ) : (
                <Table>
                  <THead>
                    <TH>อีเมล</TH>
                    <TH className="text-right">IP</TH>
                    <TH className="text-right">ครั้ง</TH>
                  </THead>
                  {data.suspicious.multi_ip_users.map((r) => (
                    <TR key={r.user_id}>
                      <TD className="text-[13px]">{r.email}</TD>
                      <TD className="text-right font-mono">{r.ip_count}</TD>
                      <TD className="text-right font-mono text-muted">{r.request_count}</TD>
                    </TR>
                  ))}
                </Table>
              )}
            </div>
          </div>
        )}
      </Section>

      <Section title="พื้นที่จัดเก็บ (Cloudflare R2)" hint="ทดสอบเข้าถึง bucket แบบ HEAD">
        <dl className="border-t border-rule">
          <KeyValue
            k="สถานะ"
            v={
              <StatusDot
                ok={data.storage.reachable}
                labelOk="เชื่อมต่อได้"
                labelNo="เชื่อมต่อไม่ได้"
              />
            }
          />
          <KeyValue k="Bucket" v={data.storage.bucket ?? "—"} />
          <KeyValue k="Latency" v={`${data.storage.latency_ms} ms`} />
          {data.storage.error && (
            <KeyValue k="Error" v={<span className="font-mono text-[12px] text-oxblood">{data.storage.error}</span>} />
          )}
        </dl>
      </Section>

      <Section title="เซสชันเล่นวิดีโอที่ active" hint="นับจาก Redis — ใกล้แตะเพดานต่อบัญชีหรือไม่">
        <dl className="border-t border-rule mb-6">
          <KeyValue k="รวมเซสชันสด" v={formatNumber(data.sessions.total_active)} />
          <KeyValue k="เพดานต่อบัญชี" v={data.sessions.max_per_user} />
          <KeyValue k="วิดีโอทั้งหมด" v={formatNumber(data.videos.total)} />
          <KeyValue k="วิดีโอใหม่วันนี้" v={formatNumber(data.videos.encoded_today)} />
        </dl>

        {data.sessions.near_max.length > 0 && (
          <>
            <p className="text-[12px] uppercase tracking-[0.18em] text-muted mb-3">
              บัญชีที่ใกล้เพดาน
            </p>
            <Table>
              <THead>
                <TH>user_id</TH>
                <TH className="text-right">เซสชันสด</TH>
              </THead>
              {data.sessions.near_max.map((r) => (
                <TR key={r.user_id}>
                  <TD className="font-mono text-[11px]">{r.user_id}</TD>
                  <TD className="text-right font-mono">
                    {r.count}/{data.sessions.max_per_user}
                  </TD>
                </TR>
              ))}
            </Table>
          </>
        )}
      </Section>
    </Page>
  );
}
