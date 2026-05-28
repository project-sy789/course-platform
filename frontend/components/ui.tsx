// Editorial UI kit. Keeps the language consistent across pages so the
// redesigns stay short — every page imports a few of these instead of
// hand-rolling its own card / input / button.

import { ReactNode } from "react";

/* -------------------------------------------------------------------- */
/* Layout primitives                                                     */
/* -------------------------------------------------------------------- */

export function Page({
  children,
  width = "wide",
}: {
  children: ReactNode;
  width?: "wide" | "narrow" | "column";
}) {
  const w =
    width === "narrow" ? "max-w-xl"
    : width === "column" ? "max-w-3xl"
    : "max-w-6xl";
  return <main className={`${w} mx-auto px-6 pt-10 pb-16`}>{children}</main>;
}

export function Eyebrow({
  children,
  align = "left",
}: {
  children: ReactNode;
  align?: "left" | "between";
}) {
  return (
    <div
      className={
        "flex items-center gap-4 text-[11px] uppercase tracking-[0.22em] text-muted mb-6 " +
        (align === "between" ? "" : "")
      }
    >
      <span>{children}</span>
      <span className="grow border-t border-rule/40" />
    </div>
  );
}

export function PageTitle({
  kicker,
  children,
}: {
  kicker?: ReactNode;
  children: ReactNode;
}) {
  return (
    <header className="mb-10 pb-6 border-b border-rule">
      {kicker && (
        <div className="text-[11px] uppercase tracking-[0.22em] text-oxblood mb-3">
          {kicker}
        </div>
      )}
      <h1 className="font-display font-semibold leading-[1.04] tracking-[-0.02em] text-[clamp(2rem,4.4vw,3.4rem)]">
        {children}
      </h1>
    </header>
  );
}

export function Section({
  title,
  hint,
  children,
  tone = "default",
}: {
  title: ReactNode;
  hint?: ReactNode;
  children: ReactNode;
  tone?: "default" | "danger";
}) {
  return (
    <section
      className={
        "py-8 border-t border-rule " +
        (tone === "danger" ? "" : "")
      }
    >
      <div className="grid md:grid-cols-12 gap-6 md:gap-10">
        <div className="md:col-span-4">
          <h2
            className={
              "font-display text-[22px] leading-tight " +
              (tone === "danger" ? "text-oxblood" : "")
            }
          >
            {title}
          </h2>
          {hint && (
            <p className="text-[13px] text-muted mt-2 leading-snug">
              {hint}
            </p>
          )}
        </div>
        <div className="md:col-span-8">{children}</div>
      </div>
    </section>
  );
}

export function Hairline() {
  return <div className="border-t border-rule" />;
}

/* -------------------------------------------------------------------- */
/* Form primitives                                                       */
/* -------------------------------------------------------------------- */

const fieldBase =
  "w-full bg-transparent border-0 border-b border-rule px-0 py-2 " +
  "text-[15px] outline-none focus:border-b-2 focus:border-oxblood " +
  "placeholder:text-muted/70 transition-colors";

export function Field({
  label,
  hint,
  children,
}: {
  label?: ReactNode;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <label className="block">
      {label && (
        <span className="block text-[11px] uppercase tracking-[0.18em] text-muted mb-1">
          {label}
        </span>
      )}
      {children}
      {hint && (
        <span className="block text-[12px] text-muted mt-1 leading-snug">
          {hint}
        </span>
      )}
    </label>
  );
}

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${fieldBase} ${props.className ?? ""}`} />;
}

export function Textarea(
  props: React.TextareaHTMLAttributes<HTMLTextAreaElement>,
) {
  return (
    <textarea
      {...props}
      className={`${fieldBase} resize-y ${props.className ?? ""}`}
    />
  );
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`${fieldBase} ${props.className ?? ""}`} />;
}

/* -------------------------------------------------------------------- */
/* Buttons                                                               */
/* -------------------------------------------------------------------- */

type BtnTone = "primary" | "ghost" | "danger" | "link";
const btn: Record<BtnTone, string> = {
  primary:
    "bg-ink text-paper border border-ink hover:bg-oxblood hover:border-oxblood",
  ghost:
    "bg-transparent border border-rule hover:border-ink",
  danger:
    "bg-oxblood text-paper border border-oxblood hover:bg-ink hover:border-ink",
  link: "border-0 underline underline-offset-[6px] decoration-1 px-0 py-0",
};

export function Button({
  tone = "primary",
  className = "",
  children,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  tone?: BtnTone;
}) {
  const base =
    tone === "link"
      ? "inline-block text-[14px] disabled:opacity-50 transition"
      : "inline-block px-4 py-2 text-[13px] uppercase tracking-[0.14em] " +
        "transition disabled:opacity-40 disabled:cursor-not-allowed";
  return (
    <button {...rest} className={`${base} ${btn[tone]} ${className}`}>
      {children}
    </button>
  );
}

/* -------------------------------------------------------------------- */
/* Display primitives                                                    */
/* -------------------------------------------------------------------- */

export function Pill({
  tone = "neutral",
  children,
}: {
  tone?: "neutral" | "ok" | "warn" | "danger";
  children: ReactNode;
}) {
  const c =
    tone === "ok" ? "border-ink text-ink"
    : tone === "warn" ? "border-oxblood text-oxblood"
    : tone === "danger" ? "border-oxblood bg-oxblood text-paper"
    : "border-muted text-muted";
  return (
    <span
      className={
        "inline-block text-[10px] uppercase tracking-[0.18em] px-2 py-[2px] " +
        "border " +
        c
      }
    >
      {children}
    </span>
  );
}

export function KeyValue({
  k,
  v,
}: {
  k: ReactNode;
  v: ReactNode;
}) {
  return (
    <div className="grid grid-cols-[10rem_1fr] gap-4 py-2 border-b border-rule/40 text-[14px]">
      <dt className="text-muted">{k}</dt>
      <dd className="font-mono text-[13px] break-all">{v}</dd>
    </div>
  );
}

export function StatusDot({
  ok,
  labelOk = "พร้อมใช้งาน",
  labelNo = "ยังไม่ตั้งค่า",
}: {
  ok: boolean;
  labelOk?: string;
  labelNo?: string;
}) {
  return (
    <span className="inline-flex items-center gap-2 text-[12px]">
      <span
        className={
          "inline-block w-[6px] h-[6px] rounded-full " +
          (ok ? "bg-ink" : "bg-muted/60")
        }
      />
      <span className={ok ? "text-ink" : "text-muted"}>
        {ok ? labelOk : labelNo}
      </span>
    </span>
  );
}

/* -------------------------------------------------------------------- */
/* Tables                                                                */
/* -------------------------------------------------------------------- */

export function Table({ children }: { children: ReactNode }) {
  return (
    <div className="border-t border-b border-rule">
      <table className="w-full text-[13px]">{children}</table>
    </div>
  );
}

export function THead({ children }: { children: ReactNode }) {
  return (
    <thead>
      <tr className="text-left">
        {children}
      </tr>
    </thead>
  );
}

export function TH({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <th
      className={
        "py-2 px-3 text-[10px] uppercase tracking-[0.2em] text-muted " +
        "font-normal border-b border-rule " +
        className
      }
    >
      {children}
    </th>
  );
}

export function TD({ children, className = "", colSpan, title }: {
  children: ReactNode;
  className?: string;
  colSpan?: number;
  title?: string;
}) {
  return (
    <td colSpan={colSpan} title={title} className={`py-3 px-3 align-top ${className}`}>
      {children}
    </td>
  );
}

export function TR({ children }: { children: ReactNode }) {
  return <tr className="border-b border-rule/40">{children}</tr>;
}

/* -------------------------------------------------------------------- */
/* Misc                                                                  */
/* -------------------------------------------------------------------- */

export function ErrorNote({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <p className="text-[13px] text-oxblood border-l-2 border-oxblood pl-3 py-1 my-2">
      {children}
    </p>
  );
}

export function OkNote({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <p className="text-[13px] text-ink border-l-2 border-ink pl-3 py-1 my-2">
      {children}
    </p>
  );
}

export function Loading({ label = "กำลังจัดหน้า…" }: { label?: string }) {
  return <p className="text-muted italic py-8">{label}</p>;
}
