import { db, ensureSchema, readBody, isAdmin } from "./_lib.js";

export default async function handler(req, res) {
  try {
    await ensureSchema();
    if (req.method === "GET") {
      // 浏览 FAQ 对所有访客开放（附评论数）
      const r = await db().execute(
        "SELECT id, question, answer, model, upvotes, created_at, (SELECT COUNT(*) FROM faq_comments c WHERE c.faq_id = faq.id) AS comment_count FROM faq WHERE status = 'published' ORDER BY upvotes DESC, id DESC LIMIT 200"
      );
      return res.status(200).json({ items: r.rows });
    }
    if (req.method === "POST") {
      if (!isAdmin(req)) return res.status(401).json({ error: "仅管理员可写入 FAQ" });
      const { question, answer, model } = readBody(req);
      if (!String(question || "").trim() || !String(answer || "").trim()) {
        return res.status(400).json({ error: "question 和 answer 不能为空" });
      }
      const ins = await db().execute({
        sql: "INSERT INTO faq (question, answer, model) VALUES (?, ?, ?)",
        args: [String(question), String(answer), model || null],
      });
      const row = await db().execute({ sql: "SELECT * FROM faq WHERE id = ?", args: [Number(ins.lastInsertRowid)] });
      return res.status(200).json({ ok: true, faq: row.rows[0] });
    }
    res.status(405).json({ error: "method not allowed" });
  } catch (e) {
    res.status(500).json({ error: String(e && e.message || e) });
  }
}
