// ═══════════════════════════════════════════════════════════
// أدوات مساعدة
// ═══════════════════════════════════════════════════════════

export function normalizeDigits(str) {
  return String(str)
    .replace(/[٠-٩]/g, d => "٠١٢٣٤٥٦٧٨٩".indexOf(d))
    .replace(/[۰-۹]/g, d => "۰۱۲۳۴۵۶۷۸۹".indexOf(d));
}

export function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

// 🔴 تحويل آمن للـ Base64 (النسخة القديمة كانت بتنهار مع الصوت الطويل)
export function bufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  const CHUNK = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return Buffer.from(binary, "binary").toString("base64");
}
