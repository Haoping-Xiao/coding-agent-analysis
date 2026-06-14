// FAQ 数据库层（SQLite）。存放被用户「采纳」的问答，供网站回填使用。
import Database from "better-sqlite3";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.FAQ_DB_PATH || join(__dirname, "faq.db");

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");

db.exec(`
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

export function addFaq({ question, answer, model }) {
  const q = String(question || "").trim();
  const a = String(answer || "").trim();
  if (!q || !a) throw new Error("question 和 answer 不能为空");
  const stmt = db.prepare(
    "INSERT INTO faq (question, answer, model) VALUES (?, ?, ?)"
  );
  const info = stmt.run(q, a, model || null);
  return getFaq(info.lastInsertRowid);
}

export function getFaq(id) {
  return db.prepare("SELECT * FROM faq WHERE id = ?").get(id);
}

export function listFaq({ limit = 100 } = {}) {
  return db
    .prepare(
      "SELECT id, question, answer, model, upvotes, created_at FROM faq WHERE status = 'published' ORDER BY upvotes DESC, id DESC LIMIT ?"
    )
    .all(limit);
}

export function upvoteFaq(id) {
  db.prepare("UPDATE faq SET upvotes = upvotes + 1 WHERE id = ?").run(id);
  return getFaq(id);
}

export function countFaq() {
  return db.prepare("SELECT COUNT(*) AS n FROM faq WHERE status = 'published'").get().n;
}

export default db;
