"use client";
import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { promptpayPayload } from "@/lib/promptpay";

type Props = {
  promptpayId: string;
  amountBaht: number | null;
  size?: number;
};

/**
 * Renders an editorial-style PromptPay QR. Falls back to a small note when
 * the id can't be parsed so the buyer page never silently breaks.
 */
export default function PromptPayQR({ promptpayId, amountBaht, size = 220 }: Props) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const payload = promptpayPayload(promptpayId, amountBaht);
    if (!payload) {
      setError("รูปแบบ PromptPay ID ไม่ถูกต้อง — แอดมินตั้งเป็นเบอร์ ๑๐ หลัก หรือเลขบัตรประชาชน ๑๓ หลัก");
      return;
    }
    setError(null);
    if (!ref.current) return;
    QRCode.toCanvas(ref.current, payload, {
      errorCorrectionLevel: "M",
      margin: 1,
      width: size,
      color: { dark: "#1c1814", light: "#f5efe1" },
    }).catch((e) => setError(`สร้าง QR ไม่สำเร็จ: ${e?.message ?? e}`));
  }, [promptpayId, amountBaht, size]);

  if (error) {
    return (
      <div className="text-[12px] text-oxblood italic max-w-[16rem]">
        {error}
      </div>
    );
  }

  return (
    <div className="inline-block border border-rule p-3 bg-paper">
      <canvas ref={ref} aria-label="PromptPay QR" />
      <div className="mt-2 text-[10px] uppercase tracking-[0.2em] text-muted text-center font-mono">
        PromptPay
      </div>
    </div>
  );
}
