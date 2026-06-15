import { db, ensureSchema, readBody, isAdmin, adminName } from "./_lib.js";

// FAQ 评论：
//  GET ?faqId=N        → 该条 FAQ 的评论（公开）
//  GET ?all=1          → 全部评论（管理员；供后续 AI 基于反馈优化网站）
//  POST {faqId, author?, body} → 留言（公开，任何访客都能反馈）
export default async function handler(req, res) {
  try {
    await ensureSchema();
    if (req.method === "GET") {
      if (req.query.all === "1") {
        if (!isAdmin(req)) return res.status(401).json({ error: "仅管理员可拉取全部评论" });
        const r = await db().execute("SELECT id, faq_id, author, body, created_at FROM faq_comments ORDER BY id DESC LIMIT 1000");
        return res.status(200).json({ items: r.rows });
      }
      const faqId = Number(req.query.faqId);
      if (!faqId) return res.status(400).json({ error: "需要 faqId" });
      const r = await db().execute({ sql: "SELECT id, faq_id, author, body, created_at FROM faq_comments WHERE faq_id = ? ORDER BY id ASC LIMIT 500", args: [faqId] });
      return res.status(200).json({ items: r.rows });
    }
    if (req.method === "POST") {
      const { faqId, author, body } = readBody(req);
      const fid = Number(faqId);
      const b = String(body || "").trim();
      if (!fid || !b) return res.status(400).json({ error: "faqId 和评论内容必填" });
      if (b.length > 2000) return res.status(400).json({ error: "评论过长（≤2000 字）" });
      // 昵称：登录则用管理员用户名（服务端权威，忽略前端传入）；否则用前端随机昵称，缺失再兜底随机。
      const a = isAdmin(req)
        ? adminName()
        : ((String(author || "").trim().slice(0, 40)) || ("访客" + Math.random().toString(36).slice(2, 6)));
      const ins = await db().execute({ sql: "INSERT INTO faq_comments (faq_id, author, body) VALUES (?, ?, ?)", args: [fid, a, b.slice(0, 2000)] });
      const row = await db().execute({ sql: "SELECT id, faq_id, author, body, created_at FROM faq_comments WHERE id = ?", args: [Number(ins.lastInsertRowid)] });
      return res.status(200).json({ ok: true, comment: row.rows[0] });
    }
    res.status(405).json({ error: "method not allowed" });
  } catch (e) {
    res.status(500).json({ error: String(e && e.message || e) });
  }
}
