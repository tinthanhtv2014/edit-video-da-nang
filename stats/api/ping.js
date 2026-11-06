// POST /api/ping — nhận 1 ping "session_start" ẩn danh từ Klip Studio
// (web + desktop) và ghi 1 document vào MongoDB Atlas (klip-stats.sessions).
//
// Riêng tư theo thiết kế:
// - Payload bị whitelist cứng ở lib/validate.js: chỉ {event, surface,
//   version, lang, anonId} mới tới được database.
// - Endpoint KHÔNG đọc/ghi IP, KHÔNG ghi user-agent, KHÔNG log payload.
// - Document lưu xuống chỉ có thêm `ts` (thời điểm phía server).
import { getSessionsCollection } from "../lib/mongo.js";
import { validatePingPayload } from "../lib/validate.js";

const MAX_BODY_BYTES = 1024; // payload hợp lệ chỉ ~120 byte; 1KB là trần cứng

function setCors(req, res) {
  // App chạy ở origin khác (trang web/desktop localhost) nên cần CORS.
  // QUAN TRỌNG: navigator.sendBeacon gửi kèm credentials mode "include",
  // nên Access-Control-Allow-Origin "*" sẽ bị trình duyệt CHẶN ở preflight
  // (đã bắt được bằng harness vòng 23 phía app). Vì vậy phải echo lại
  // đúng Origin của request + Allow-Credentials: true. An toàn vì
  // endpoint này không dùng cookie/session làm quyền gì cả — chỉ nhận
  // ping ẩn danh đã qua whitelist và trả 204 rỗng.
  const origin = req.headers?.origin;
  res.setHeader("Access-Control-Allow-Origin", typeof origin === "string" && origin ? origin : "*");
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "content-type");
  res.setHeader("Access-Control-Max-Age", "86400");
}

/**
 * Đọc body ở cả 2 dạng Vercel có thể đưa: object (đã parse khi
 * content-type application/json) hoặc string thô — parse lại tại đây.
 * Đồng thời thực thi trần 1KB ở mọi đường.
 */
function readBody(req) {
  const body = req.body;
  if (typeof body === "string") {
    if (body.length > MAX_BODY_BYTES) return { tooBig: true };
    try {
      return { body: JSON.parse(body) };
    } catch {
      return { invalid: true };
    }
  }
  if (body !== null && typeof body === "object") {
    let len;
    try {
      len = JSON.stringify(body).length;
    } catch {
      return { invalid: true };
    }
    if (len > MAX_BODY_BYTES) return { tooBig: true };
    return { body };
  }
  return { invalid: true };
}

/** Factory để test cục bộ tiêm collection giả; bản chạy thật dùng mặc định. */
export function createPingHandler(deps = {}) {
  const getCollection = deps.getSessionsCollection || getSessionsCollection;
  return async function pingHandler(req, res) {
    setCors(req, res);
    if (req.method === "OPTIONS") {
      res.status(204).end();
      return;
    }
    if (req.method !== "POST") {
      res.status(405).json({ error: "method_not_allowed" });
      return;
    }
    // Lớp chặn rẻ nhất: content-length khai báo đã > 1KB thì khỏi đọc.
    const declared = Number(req.headers?.["content-length"] || 0);
    if (declared > MAX_BODY_BYTES) {
      res.status(400).json({ error: "body_too_large" });
      return;
    }
    const { body, invalid, tooBig } = readBody(req);
    if (invalid) {
      res.status(400).json({ error: "invalid_json" });
      return;
    }
    if (tooBig) {
      res.status(400).json({ error: "body_too_large" });
      return;
    }
    const clean = validatePingPayload(body);
    if (!clean) {
      res.status(400).json({ error: "invalid_payload" });
      return;
    }
    try {
      const col = await getCollection();
      await col.insertOne({ ts: new Date(), ...clean });
    } catch {
      // Không lộ chi tiết nội bộ (URI/host/lỗi driver) ra response.
      res.status(503).json({ error: "unavailable" });
      return;
    }
    res.status(204).end();
  };
}

export default createPingHandler();
