// FAQ 数据库层（libSQL / Turso）。
// - 线上：设 TURSO_DATABASE_URL (libsql://...) + TURSO_AUTH_TOKEN → 用 Turso，serverless 友好。
// - 本地：不设以上变量时自动 fallback 到本地文件 file:faq.db（仍是 SQLite，零依赖差异）。
import { createClient } from "@libsql/client";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

function makeClient() {
  const url = process.env.TURSO_DATABASE_URL;
  if (url) {
    return createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });
  }
  const file = process.env.FAQ_DB_PATH || join(__dirname, "faq.db");
  return createClient({ url: `file:${file}` });
}

const db = makeClient();
export const isRemote = Boolean(process.env.TURSO_DATABASE_URL);

let ready;
export function init() {
  if (!ready) {
    ready = db.executeMultiple(`
      CREATE TABLE IF NOT EXISTS faq (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        question    TEXT NOT NULL,
        answer      TEXT NOT NULL,
        model       TEXT,
        upvotes     INTEGER NOT NULL DEFAULT 0,
        status      TEXT NOT NULL DEFAULT 'published',
        created_at  TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
  }
  return ready;
}

export async function addFaq({ question, answer, model }) {
  await init();
  const q = String(question || "").trim();
  const a = String(answer || "").trim();
  if (!q || !a) throw new Error("question 和 answer 不能为空");
  const res = await db.execute({
    sql: "INSERT INTO faq (question, answer, model) VALUES (?, ?, ?)",
    args: [q, a, model || null],
  });
  return getFaq(Number(res.lastInsertRowid));
}

export async function getFaq(id) {
  await init();
  const res = await db.execute({ sql: "SELECT * FROM faq WHERE id = ?", args: [id] });
  return res.rows[0] || null;
}

export async function listFaq({ limit = 100 } = {}) {
  await init();
  const res = await db.execute({
    sql: "SELECT id, question, answer, model, upvotes, created_at FROM faq WHERE status = 'published' ORDER BY upvotes DESC, id DESC LIMIT ?",
    args: [limit],
  });
  return res.rows;
}

export async function upvoteFaq(id) {
  await init();
  await db.execute({ sql: "UPDATE faq SET upvotes = upvotes + 1 WHERE id = ?", args: [id] });
  return getFaq(id);
}

export async function countFaq() {
  await init();
  const res = await db.execute("SELECT COUNT(*) AS n FROM faq WHERE status = 'published'");
  return Number(res.rows[0].n);
}

export async function deleteFaq(id) {
  await init();
  const fid = Number(id);
  if (!fid) throw new Error("需要有效的 FAQ id");
  await db.execute({ sql: "DELETE FROM faq_comments WHERE faq_id = ?", args: [fid] });
  await db.execute({ sql: "DELETE FROM faq WHERE id = ?", args: [fid] });
}

export default db;
