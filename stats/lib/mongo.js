// Kết nối MongoDB Atlas — cache client promise ở globalThis để các lần
// invoke "warm" của serverless dùng lại đúng 1 connection pool (mẫu chuẩn
// cho Vercel Functions). Kết nối LAZY: chỉ tạo khi handler gọi lần đầu,
// import file này không bao giờ tự kết nối hay throw.
import { MongoClient } from "mongodb";

export const DB_NAME = "klip-stats";
export const COLLECTION_NAME = "sessions";

const GLOBAL_KEY = "__klipStatsMongoClientPromise";

export function getMongoClientPromise() {
  if (!globalThis[GLOBAL_KEY]) {
    const uri = process.env.MONGO_URI;
    if (!uri) {
      // Thiếu cấu hình: trả promise reject để handler biến thành 503 gọn.
      const p = Promise.reject(new Error("MONGO_URI is not set"));
      p.catch(() => {});
      return p;
    }
    const client = new MongoClient(uri, {
      serverSelectionTimeoutMS: 4000,
      connectTimeoutMS: 4000,
      maxPoolSize: 5,
    });
    const p = client.connect();
    // Kết nối hỏng (mạng/credential) thì xoá cache để lần gọi sau thử lại,
    // không kẹt vĩnh viễn ở một promise đã reject.
    p.catch(() => {
      if (globalThis[GLOBAL_KEY] === p) delete globalThis[GLOBAL_KEY];
    });
    globalThis[GLOBAL_KEY] = p;
  }
  return globalThis[GLOBAL_KEY];
}

/** Collection `sessions` trong DB `klip-stats` (tên cố định, không theo URI). */
export async function getSessionsCollection() {
  const client = await getMongoClientPromise();
  return client.db(DB_NAME).collection(COLLECTION_NAME);
}
