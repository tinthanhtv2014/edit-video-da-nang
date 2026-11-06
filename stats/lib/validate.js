// Whitelist CỨNG cho payload ping — trái tim của cam kết riêng tư:
// chỉ đúng 5 trường dưới đây được phép đi vào database, thiếu/thừa/sai
// kiểu đều bị loại ở cửa (400), không có ngoại lệ và không "lưu tạm".

const EVENTS = new Set(["session_start"]);
const SURFACES = new Set(["web", "desktop"]);
const LANGS = new Set(["en", "vi"]);
const VERSION_RE = /^\d+\.\d+\.\d+$/; // x.y.z
const ANON_RE = /^[0-9a-f]{16,64}$/; // hex thường, 16–64 ký tự
const FIELDS = ["event", "surface", "version", "lang", "anonId"];

/**
 * Trả về object sạch {event, surface, version, lang, anonId} nếu payload
 * hợp lệ tuyệt đối, ngược lại trả null.
 */
export function validatePingPayload(body) {
  if (body === null || typeof body !== "object" || Array.isArray(body)) return null;
  const keys = Object.keys(body);
  if (keys.length !== FIELDS.length) return null; // thừa hoặc thiếu trường
  for (const k of keys) if (!FIELDS.includes(k)) return null;
  const { event, surface, version, lang, anonId } = body;
  if (!EVENTS.has(event)) return null;
  if (!SURFACES.has(surface)) return null;
  if (typeof version !== "string" || !VERSION_RE.test(version)) return null;
  if (!LANGS.has(lang)) return null;
  if (typeof anonId !== "string" || !ANON_RE.test(anonId)) return null;
  return { event, surface, version, lang, anonId };
}
