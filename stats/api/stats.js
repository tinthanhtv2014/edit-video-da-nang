// GET /api/stats — số liệu đếm phiên cho chủ app xem nhanh.
// Bắt buộc có key khớp env STATS_KEY, truyền qua header `x-stats-key`
// hoặc query `?key=`. So sánh an toàn: băm SHA-256 cả hai phía rồi mới
// timingSafeEqual (không lộ độ dài key, không rò rỉ theo thời gian).
import { createHash, timingSafeEqual } from "node:crypto";
import { getSessionsCollection } from "../lib/mongo.js";

function keyMatches(provided, expected) {
  if (typeof provided !== "string" || provided.length === 0) return false;
  if (typeof expected !== "string" || expected.length === 0) return false;
  const a = createHash("sha256").update(provided, "utf8").digest();
  const b = createHash("sha256").update(expected, "utf8").digest();
  return timingSafeEqual(a, b);
}

/** Factory để test cục bộ tiêm collection giả; bản chạy thật dùng mặc định. */
export function createStatsHandler(deps = {}) {
  const getCollection = deps.getSessionsCollection || getSessionsCollection;
  const getExpectedKey = deps.getStatsKey || (() => process.env.STATS_KEY);
  return async function statsHandler(req, res) {
    if (req.method !== "GET") {
      res.status(405).json({ error: "method_not_allowed" });
      return;
    }
    const expected = getExpectedKey();
    if (!expected) {
      res.status(503).json({ error: "not_configured" });
      return;
    }
    const provided = req.headers?.["x-stats-key"] || req.query?.key;
    if (!keyMatches(provided, expected)) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    try {
      const col = await getCollection();
      const now = new Date();
      const startToday = new Date(now);
      startToday.setUTCHours(0, 0, 0, 0); // "hôm nay" tính theo UTC
      const start7d = new Date(now.getTime() - 7 * 24 * 3600 * 1000);
      const [total, today, last7d, surfaceRows, versionRows, anonIds] =
        await Promise.all([
          col.countDocuments({}),
          col.countDocuments({ ts: { $gte: startToday } }),
          col.countDocuments({ ts: { $gte: start7d } }),
          col
            .aggregate([{ $group: { _id: "$surface", n: { $sum: 1 } } }])
            .toArray(),
          col
            .aggregate([
              { $group: { _id: "$version", n: { $sum: 1 } } },
              { $sort: { n: -1 } },
            ])
            .toArray(),
          col.distinct("anonId"),
        ]);
      const bySurface = {};
      for (const r of surfaceRows) bySurface[r._id] = r.n;
      const byVersion = {};
      for (const r of versionRows) byVersion[r._id] = r.n;
      res.status(200).json({
        total,
        today,
        last7d,
        bySurface,
        byVersion,
        uniqueAnon: anonIds.length,
      });
    } catch {
      res.status(503).json({ error: "unavailable" });
    }
  };
}

export default createStatsHandler();
