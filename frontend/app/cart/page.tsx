"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ApiError, OrderQuote, getSlipInfo, quoteOrder, uploadSlipOrder, SlipInfo,
} from "@/lib/api";
import {
  CartEntry, getCart, removeFromCart, clearCart, subscribe, toApiItems,
} from "@/lib/cart";
import { formatTHB } from "@/lib/format";
import PromptPayQR from "@/components/PromptPayQR";
import {
  Button, ErrorNote, Input, KeyValue, Loading, OkNote, Page, PageTitle,
  Section,
} from "@/components/ui";

export default function CartPage() {
  const router = useRouter();
  const [items, setItems] = useState<CartEntry[]>([]);
  const [info, setInfo] = useState<SlipInfo | null>(null);
  const [quote, setQuote] = useState<OrderQuote | null>(null);
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState("");
  const [appliedCode, setAppliedCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<{ status: string; message: string } | null>(null);

  useEffect(() => {
    setItems(getCart());
    return subscribe(setItems);
  }, []);

  useEffect(() => {
    getSlipInfo().then(setInfo).catch(() => setInfo(null));
  }, []);

  // Re-quote whenever cart or applied code changes.
  useEffect(() => {
    if (items.length === 0) { setQuote(null); return; }
    let alive = true;
    quoteOrder(toApiItems(items), appliedCode ?? undefined)
      .then((q) => { if (alive) setQuote(q); })
      .catch((e: ApiError) => {
        if (e.status === 401) router.push("/login");
        else setError(e.message);
      });
    return () => { alive = false; };
  }, [items, appliedCode, router]);

  async function applyCoupon() {
    if (!code.trim()) return;
    setAppliedCode(code.trim().toUpperCase());
  }
  function clearCoupon() {
    setCode(""); setAppliedCode(null);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!quote) return;
    const isFree = quote.final_baht === 0;
    if (!file && !isFree) return;
    setBusy(true); setError(null);
    try {
      const r = await uploadSlipOrder({
        items: toApiItems(items),
        image: isFree ? null : file,
        coupon_code: appliedCode ?? undefined,
      });
      setResult({ status: r.status, message: r.message });
      clearCart();
    } catch (e: any) {
      if (e instanceof ApiError && e.status === 401) { router.push("/login"); return; }
      setError(e?.message ?? "อัปโหลดไม่สำเร็จ");
    } finally { setBusy(false); }
  }

  if (result) {
    return (
      <Page width="narrow">
        <div className="border-b border-rule pb-4 mb-6">
          <div className="text-[11px] uppercase tracking-[0.22em] text-oxblood mb-2">
            {result.status === "auto_approved" ? "ตรวจสอบสลิปอัตโนมัติ" : "รอเจ้าหน้าที่ตรวจ"}
          </div>
          <h1 className="font-display font-semibold text-[2.2rem] leading-none tracking-[-0.02em]">
            {result.status === "auto_approved" ? "ยืนยันการชำระเงินสำเร็จ" : "ได้รับสลิปแล้ว"}
          </h1>
        </div>
        <p className="text-[15px] leading-relaxed mb-6">{result.message}</p>
        <div className="flex flex-wrap gap-3">
          <Link href="/account"
            className="inline-block px-4 py-2 text-[13px] uppercase tracking-[0.14em] bg-ink text-paper border border-ink hover:bg-oxblood hover:border-oxblood transition">
            ดูคอร์สที่ซื้อ →
          </Link>
          <Link href="/"
            className="inline-block px-4 py-2 text-[13px] uppercase tracking-[0.14em] border border-rule hover:border-ink transition">
            กลับสารบัญ
          </Link>
        </div>
      </Page>
    );
  }

  if (items.length === 0) {
    return (
      <Page width="narrow">
        <PageTitle kicker="ตะกร้าสินค้า">ยังไม่มีคอร์สในตะกร้า</PageTitle>
        <p className="text-[14px] text-muted leading-relaxed mb-6">
          เลือกคอร์สที่สนใจจากสารบัญ แล้วกด “เพิ่มลงตะกร้า” — รวมหลายคอร์สแล้วโอนรวดเดียวก็ได้
        </p>
        <Link href="/"
          className="inline-block px-4 py-2 text-[13px] uppercase tracking-[0.14em] bg-ink text-paper border border-ink hover:bg-oxblood hover:border-oxblood transition">
          ไปสารบัญคอร์ส →
        </Link>
      </Page>
    );
  }

  if (!quote || !info) return <Page width="narrow"><Loading /></Page>;

  const isFreeWithCoupon = quote.final_baht === 0 && quote.coupon != null;

  return (
    <Page width="column">
      <PageTitle kicker="ตะกร้าสินค้า">รวมโอนครั้งเดียว</PageTitle>

      <div className="grid md:grid-cols-12 gap-10">
        <div className="md:col-span-7 space-y-10">
          <Section title="รายการในตะกร้า" hint={`${items.length} รายการ`}>
            <ul className="border-t border-rule">
              {quote.lines.map((l, i) => (
                <li key={i} className="border-b border-rule/40 py-4 flex items-baseline gap-4 flex-wrap">
                  <div className="grow min-w-[12rem]">
                    <p className="font-display text-[17px]">{l.title}</p>
                    {l.line_discount_baht > 0 && (
                      <p className="text-[12px] text-oxblood font-mono mt-1">
                        − {formatTHB(l.line_discount_baht)} (คูปอง)
                      </p>
                    )}
                  </div>
                  <div className="text-right">
                    {l.line_discount_baht > 0 ? (
                      <>
                        <p className="text-[12px] text-muted line-through font-mono">
                          {formatTHB(l.unit_price_baht)}
                        </p>
                        <p className="font-mono tabular-nums">
                          {formatTHB(l.line_final_baht)}
                        </p>
                      </>
                    ) : (
                      <p className="font-mono tabular-nums">
                        {formatTHB(l.unit_price_baht)}
                      </p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => removeFromCart(i)}
                    className="text-[12px] text-oxblood hover:underline underline-offset-4 decoration-1"
                  >
                    ลบ
                  </button>
                </li>
              ))}
            </ul>
          </Section>

          {!isFreeWithCoupon && (
            <section>
              <div className="text-[11px] uppercase tracking-[0.22em] text-muted mb-4">
                ขั้นที่ ๑ — โอนเงินมาที่
              </div>
              <dl className="border-t border-rule">
                <KeyValue k="ธนาคาร" v={info.bank_name || "—"} />
                <KeyValue k="เลขบัญชี" v={info.account_number || "—"} />
                <KeyValue k="ชื่อบัญชี" v={info.account_name || "—"} />
                {info.promptpay_id && (
                  <KeyValue k="พร้อมเพย์" v={info.promptpay_id} />
                )}
              </dl>
              <p className="text-[13px] text-muted leading-relaxed mt-4">
                โอนยอด{" "}
                <span className="font-mono text-ink font-medium">
                  {formatTHB(quote.final_baht)}
                </span>{" "}
                ครั้งเดียว ครอบคลุมทุกคอร์สในตะกร้า
                {info.auto_verify
                  ? " ระบบจะตรวจสลิปอัตโนมัติและเปิดสิทธิ์ทันทีหลังจากแนบสลิป"
                  : " เจ้าหน้าที่จะตรวจสอบและเปิดสิทธิ์ภายใน ๒๔ ชั่วโมง"}
              </p>
              {info.promptpay_id && (
                <div className="mt-6 pt-6 border-t border-rule/60 flex items-start gap-6 flex-wrap">
                  <PromptPayQR
                    promptpayId={info.promptpay_id}
                    amountBaht={quote.final_baht}
                    size={170}
                  />
                  <div className="flex-1 min-w-[12rem] text-[13px] text-muted leading-relaxed">
                    <p className="text-ink font-medium mb-1">หรือสแกน QR พร้อมเพย์</p>
                    <p>
                      เปิดแอปธนาคาร → กล้องสแกน → ยอด {formatTHB(quote.final_baht)}
                      จะถูกกรอกให้อัตโนมัติ ไม่ต้องพิมพ์เอง
                    </p>
                  </div>
                </div>
              )}
            </section>
          )}

          <Section
            title="โค้ดส่วนลด (ถ้ามี)"
            hint="คูปองบางรายการลดเฉพาะคอร์ส/บทเรียนที่ตรงเท่านั้น — ระบบจะแจ้งให้เห็น"
          >
            <div className="flex gap-3 items-end max-w-md">
              <div className="grow">
                <Input
                  className="font-mono uppercase"
                  placeholder="WELCOME10"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  disabled={!!appliedCode}
                />
              </div>
              {appliedCode ? (
                <button
                  type="button"
                  onClick={clearCoupon}
                  className="text-[12px] text-oxblood hover:underline underline-offset-4 decoration-1 pb-2"
                >
                  ยกเลิก
                </button>
              ) : (
                <Button tone="ghost" onClick={applyCoupon} disabled={!code.trim()}>
                  ใช้โค้ด
                </Button>
              )}
            </div>
            {quote.coupon && (
              <OkNote>
                ใช้โค้ด <span className="font-mono">{quote.coupon.code}</span> สำเร็จ —
                ลดรวม {formatTHB(quote.coupon.discount_baht)}
              </OkNote>
            )}
            {appliedCode && !quote.coupon && quote.coupon_reason && (
              <ErrorNote>{quote.coupon_reason}</ErrorNote>
            )}
          </Section>

          <Section
            title={isFreeWithCoupon ? "ยืนยันการรับสิทธิ์" : "ขั้นที่ ๒ — แนบสลิป"}
            hint={isFreeWithCoupon
              ? "คูปองนี้เปิดสิทธิ์ให้คุณฟรี — กดยืนยันได้เลย ไม่ต้องโอนเงิน"
              : "รองรับ JPG / PNG / WebP ขนาดไม่เกิน ๔ MB"}
          >
            <form onSubmit={submit} className="space-y-5">
              {!isFreeWithCoupon && (
                <>
                  <input
                    type="file" accept="image/png,image/jpeg,image/webp" required
                    onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                    className="block w-full text-[14px] file:mr-4 file:border file:border-ink
                               file:bg-ink file:text-paper file:px-4 file:py-2
                               file:text-[12px] file:uppercase file:tracking-[0.14em]
                               file:cursor-pointer hover:file:bg-oxblood hover:file:border-oxblood"
                  />
                  {file && (
                    <p className="text-[12px] text-muted font-mono">
                      เลือกแล้ว: {file.name}
                    </p>
                  )}
                </>
              )}
              {error && <ErrorNote>{error}</ErrorNote>}
              <Button type="submit" disabled={(!file && !isFreeWithCoupon) || busy}>
                {busy ? "กำลังส่ง…"
                  : isFreeWithCoupon ? "เปิดสิทธิ์เรียนฟรี →" : "ส่งสลิปยืนยัน →"}
              </Button>
            </form>
          </Section>
        </div>

        <aside className="md:col-span-5 md:border-l md:border-rule md:pl-10">
          <div className="text-[11px] uppercase tracking-[0.22em] text-muted mb-3">
            สรุปคำสั่งซื้อ
          </div>
          <p className="font-display text-[20px] leading-snug mb-6">
            {items.length} รายการ
          </p>
          <dl className="border-t border-rule">
            <KeyValue k="ยอดรวมก่อนลด" v={formatTHB(quote.subtotal_baht)} />
            {quote.discount_baht > 0 && (
              <KeyValue
                k={`ส่วนลด · ${quote.coupon?.code ?? ""}`}
                v={`− ${formatTHB(quote.discount_baht)}`}
              />
            )}
            <KeyValue k="ภาษีมูลค่าเพิ่ม" v="รวมในราคาแล้ว" />
          </dl>
          <div className="mt-6 pt-6 border-t border-rule">
            <div className="text-[11px] uppercase tracking-[0.22em] text-muted mb-2">
              {isFreeWithCoupon ? "ยอดสุทธิ" : "ยอดที่ต้องโอน"}
            </div>
            <p className="font-display text-[40px] leading-none font-mono tabular-nums">
              {formatTHB(quote.final_baht)}
            </p>
          </div>
        </aside>
      </div>
    </Page>
  );
}
