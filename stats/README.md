# klip-stats — đếm phiên sử dụng ẩn danh cho Klip Studio

Endpoint nhỏ (Vercel Functions) nhận "ping" mỗi khi có người mở Klip Studio
và ghi vào **MongoDB Atlas** của chủ app, chỉ để biết *có ai đang dùng app
hay không, nhiều hay ít*. Số liệu mang tính tương đối: trình chặn tracking
chặn ping, desktop offline không gửi được — đó là giới hạn đã chấp nhận,
đổi lại là riêng tư tuyệt đối cho người dùng.

## Cam kết riêng tư (đã chốt với chủ app)

Lời hứa "không tải lên server" của Klip Studio là về **file/project của
người dùng** — ping này không đụng tới phạm trù đó:

| Lưu vào DB (mỗi phiên mở app) | Tuyệt đối KHÔNG lưu |
| --- | --- |
| `ts` — thời điểm (phía server) | Địa chỉ IP |
| `event` — luôn là `session_start` | User-agent / thông tin thiết bị |
| `surface` — `web` hoặc `desktop` | Tên file, tên project, nội dung |
| `version` — phiên bản app (x.y.z) | Email/tài khoản (app không có đăng nhập) |
| `lang` — ngôn ngữ giao diện (`en`/`vi`) | |
| `anonId` — mã ngẫu nhiên sinh trên máy người dùng, chỉ để phân biệt "số người" với "số phiên" | |

Payload bị **whitelist cứng** ở `lib/validate.js`: thừa/thiếu/sai kiểu
trường → 400, không ghi gì. Endpoint không đọc header nào để lưu trữ,
không log payload. Phía app còn có dòng công khai ở footer + công tắc tắt
trong modal phím tắt (`?`) — xem `src/lib/engine/stats.ts` bên klip-svelte.

## Kiến trúc

```
Klip Studio (web + desktop)
  └─ POST /api/ping  {event, surface, version, lang, anonId}   (sendBeacon, fire-and-forget)
        └─ api/ping.js → whitelist → insert 1 doc
              └─ MongoDB Atlas · DB `klip-stats` · collection `sessions`

Chủ app xem số liệu:
  └─ GET /api/stats  (header x-stats-key: <STATS_KEY>)
        └─ { total, today, last7d, bySurface, byVersion, uniqueAnon }
```

- `api/ping.js` — POST, body ≤ 1KB, trả 204. Lỗi DB → 503 gọn (không lộ chi tiết).
  CORS: **echo lại Origin** của request + `Access-Control-Allow-Credentials: true`
  (không dùng `*` — `navigator.sendBeacon` đi kèm credentials mode `include`
  nên `*` bị trình duyệt chặn ở preflight; đã kiểm chứng bằng harness phía app).
  `/api/stats` cố ý KHÔNG có CORS — chỉ gọi được từ curl/Compass có key.
- `api/stats.js` — GET, bắt buộc key khớp env `STATS_KEY` (so sánh qua SHA-256 + timingSafeEqual). Sai/thiếu key → 401.
- `lib/mongo.js` — client promise cache ở globalThis (mẫu serverless chuẩn), timeout 4s, tên DB/collection cố định `klip-stats`/`sessions`.
- `lib/validate.js` — whitelist payload.

## Biến môi trường (đặt trên Vercel, KHÔNG commit)

| Tên | Ý nghĩa |
| --- | --- |
| `MONGO_URI` | Connection string Atlas của DB user riêng (xem mục Atlas). Dạng `mongodb+srv://<user>:<password>@<cluster>/...` |
| `STATS_KEY` | Khoá bí mật tự sinh để xem /api/stats. Sinh ví dụ: `openssl rand -hex 24` |

## Việc cần làm phía MongoDB Atlas

1. **Database Access → Add New Database User**: tạo user RIÊNG cho endpoint
   (mật khẩu mạnh, lưu vào nơi an toàn). Quyền: chỉ `readWrite` trên đúng
   database `klip-stats` (chọn user → *Specific Privileges / Restrict access
   to specific clusters, databases, or collections*). **Không** dùng user
   admin/atlasAdmin cho endpoint công khai.
2. **Network Access → Add IP Address**: thêm `0.0.0.0/0` (Allow access from
   anywhere). Lý do: IP ra của serverless (Vercel) là IP động, không có dải
   cố định để whitelist. Đánh đổi này an toàn vì lớp bảo vệ chính là
   credential của DB user ở bước 1 (chỉ đọc/ghi được 1 database đếm phiên).
3. **Connect → Drivers**: lấy connection string, thay `<password>` bằng mật
   khẩu user ở bước 1 → đó là `MONGO_URI`. Database/collection
   `klip-stats.sessions` tự được tạo ở ping đầu tiên, không cần tạo tay.
   Chuỗi này **tuyệt mật**: không dán vào chat, không commit — chỉ nhập
   thẳng vào ô Environment Variables của Vercel.

## Triển khai lên Vercel

1. Đẩy thư mục này thành 1 repo Git riêng (hoặc import repo chứa nó và đặt
   Root Directory trỏ vào thư mục này).
2. [vercel.com](https://vercel.com) → **Add New… → Project** → Import repo.
   Framework Preset: **Other**. Không cần build command/output dir —
   Vercel tự nhận `api/*.js` thành functions.
3. **Settings → Environment Variables**: thêm `MONGO_URI` và `STATS_KEY`
   (Production).
4. **Deploy**. Kiểm tra nhanh:
   - `curl -i -X POST https://<domain>/api/ping -H 'content-type: application/json' -d '{"event":"session_start","surface":"web","version":"1.3.0","lang":"en","anonId":"0123456789abcdef0123456789abcdef"}'` → `204`.
   - `curl https://<domain>/api/stats -H 'x-stats-key: <STATS_KEY>'` → JSON số liệu.
5. Nối phía app (làm ở vòng triển khai, trong repo klip-svelte): điền hằng
   số `STATS_ENDPOINT_URL` trong `src/lib/engine/stats.ts` =
   `https://<domain>/api/ping`, build lại + phát hành như thường lệ. Chừng
   nào hằng số còn rỗng thì toàn bộ tính năng tự vô hiệu (không gửi gì,
   footer/công tắc cũng ẩn).

## Xem số liệu hằng ngày

- Nhanh nhất: `curl https://<domain>/api/stats -H 'x-stats-key: <STATS_KEY>'`
  (`today`/`last7d` tính theo UTC).
- Trực quan: Atlas → cluster → **Browse Collections** → `klip-stats.sessions`,
  hoặc MongoDB Compass trỏ vào cùng cluster.

## Chạy & test cục bộ

```bash
npm install
npm test        # test/run.mjs — ưu tiên mongodb-memory-server (MongoDB thật
                # trong bộ nhớ); không tải được binary thì tự rơi về
                # stub collection qua factory handler
```

Muốn chạy thử endpoint bằng HTTP thật: dùng `vercel dev` (cần Vercel CLI)
với file `.env` chứa `MONGO_URI`/`STATS_KEY` trỏ vào cluster Atlas thật
hoặc Mongo cục bộ.
