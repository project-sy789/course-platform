/**
 * PromptPay payload builder (EMVCo TLV) + QR rendering helper.
 *
 * Accepts either a Thai mobile phone (10 digits, with or without leading 0)
 * or a national ID (13 digits) and produces the EMVCo string Thai banking
 * apps decode into a transfer prefilled with our receiver and (optionally)
 * the amount. Pure client-side — no network, no PII leaves the browser.
 */

function tlv(tag: string, value: string): string {
  const len = value.length.toString().padStart(2, "0");
  return `${tag}${len}${value}`;
}

// CRC16-CCITT-FALSE: poly 0x1021, init 0xFFFF, no reflect, no xor out.
function crc16(s: string): string {
  let crc = 0xffff;
  for (let i = 0; i < s.length; i++) {
    crc ^= s.charCodeAt(i) << 8;
    for (let b = 0; b < 8; b++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

function normaliseTarget(idRaw: string): { tag: "01" | "02"; value: string } | null {
  const digits = idRaw.replace(/\D/g, "");
  if (!digits) return null;
  // 13 digits — treat as national ID.
  if (digits.length === 13) return { tag: "02", value: digits };
  // 10 digits starting with 0 — Thai mobile, e.g. 0812345678.
  if (digits.length === 10 && digits.startsWith("0")) {
    return { tag: "01", value: `0066${digits.slice(1)}` };
  }
  // 9 digits — Thai mobile already without leading 0.
  if (digits.length === 9) return { tag: "01", value: `0066${digits}` };
  // 11 digits starting with 66 — already international.
  if (digits.length === 11 && digits.startsWith("66")) {
    return { tag: "01", value: `00${digits}` };
  }
  return null;
}

/**
 * Build the EMVCo string. `amountBaht` whole-baht; pass null for static QR.
 * Returns null when the id can't be parsed — caller should fall back to a
 * plain-text "ใส่จำนวน {amount} บาท" instruction.
 */
export function promptpayPayload(
  idRaw: string,
  amountBaht: number | null,
): string | null {
  const target = normaliseTarget(idRaw);
  if (!target) return null;

  const merchant = tlv("00", "A000000677010111") + tlv(target.tag, target.value);
  const poi = amountBaht != null && amountBaht > 0 ? "12" : "11";

  let payload =
    tlv("00", "01") +              // Payload Format Indicator
    tlv("01", poi) +               // Static / Dynamic
    tlv("29", merchant) +          // Merchant Account Info (PromptPay)
    tlv("53", "764");              // Currency = THB
  if (amountBaht != null && amountBaht > 0) {
    // Whole-baht only — we don't track sub-baht. Bank apps accept ".00"
    // suffix or none; ".00" reads more obviously as money.
    payload += tlv("54", `${amountBaht}.00`);
  }
  payload += tlv("58", "TH");      // Country

  // CRC is computed over payload + tag/length placeholder for tag 63.
  const withCrcHeader = payload + "6304";
  return withCrcHeader + crc16(withCrcHeader);
}
