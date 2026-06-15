import { db, ensureSchema, readBody, isAdmin } from "./_lib.js";

// 管理员对话历史：GET 拉回（按时间正序），POST 追加一轮问答。仅管理员可访问。
export default async function handler(req, res) {
  if (!isAdmin(req)) return res.status(401).json({ error: "仅管理员可访问" });
  try {
    await ensureSchema();
    if (req.method === "GET") {
      const r = await db().execute("SELECT id, question, answer, model, steps, created_at FROM chat_history ORDER BY id ASC LIMIT 100");
      const items = r.rows.map(function (row) {
        var steps = [];
        try { steps = row.steps ? JSON.parse(row.steps) : []; } catch (_) {}
        return { id: row.id, question: row.question, answer: row.answer, model: row.model, steps: steps, created_at: row.created_at };
      });
      return res.status(200).json({ items });
    }
    if (req.method === "POST") {
      const { question, answer, model, steps } = readBody(req);
      if (!String(question || "").trim() || !String(answer || "").trim()) {
        return res.status(400).json({ error: "question 和 answer 不能为空" });
      }
      const stepsJson = JSON.stringify(Array.isArray(steps) ? steps.slice(0, 60) : []);
      const ins = await db().execute({
        sql: "INSERT INTO chat_history (question, answer, model, steps) VALUES (?, ?, ?, ?)",
        args: [String(question), String(answer), model || null, stepsJson],
      });
      return res.status(200).json({ ok: true, id: Number(ins.lastInsertRowid) });
    }
    res.status(405).json({ error: "method not allowed" });
  } catch (e) {
    res.status(500).json({ error: String(e && e.message || e) });
  }
}
