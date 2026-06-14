// AI 问答 + FAQ 后端。也直接托管 site/ 静态站点，方便单机端到端运行。
import express from "express";
import cors from "cors";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { askQuestion, hasApiKey, fsMode } from "./agent.mjs";
import { addFaq, listFaq, upvoteFaq, countFaq, isRemote } from "./db.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SITE_DIR = join(__dirname, "..", "site");
const PORT = Number(process.env.PORT || 8787);

const app = express();
app.use(cors());
app.use(express.json({ limit: "256kb" }));

// 健康检查 / 能力探测：前端用它判断后端是否在线、是否配了真实 key。
app.get("/api/health", async (_req, res) => {
  try {
    res.json({ ok: true, hasApiKey, faqCount: await countFaq() });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err.message || err) });
  }
});

// 流式问答（SSE）。前端用 fetch + ReadableStream 读取。
app.post("/api/ask", async (req, res) => {
  const question = (req.body && req.body.question) || "";
  if (!String(question).trim()) {
    return res.status(400).json({ error: "question 不能为空" });
  }

  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  const send = (event, data) =>
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  try {
    const { answer, model, status } = await askQuestion(question, (chunk) =>
      send("delta", { text: chunk })
    );
    send("final", { answer, model, status });
  } catch (err) {
    send("error", { message: String(err && err.message ? err.message : err) });
  } finally {
    res.end();
  }
});

// 采纳：把问答写入 FAQ 数据库。
app.post("/api/faq", async (req, res) => {
  try {
    const { question, answer, model } = req.body || {};
    const row = await addFaq({ question, answer, model });
    res.json({ ok: true, faq: row });
  } catch (err) {
    res.status(400).json({ error: String(err.message || err) });
  }
});

// 列出已发布 FAQ。
app.get("/api/faq", async (_req, res) => {
  try {
    res.json({ items: await listFaq({ limit: 200 }) });
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

// 顶一下某条 FAQ（有用）。
app.post("/api/faq/:id/upvote", async (req, res) => {
  try {
    const row = await upvoteFaq(Number(req.params.id));
    if (!row) return res.status(404).json({ error: "not found" });
    res.json({ ok: true, faq: row });
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

// 静态站点
app.use(express.static(SITE_DIR));

app.listen(PORT, () => {
  console.log(`[server] listening on http://localhost:${PORT}`);
  console.log(`[server] serving site from ${SITE_DIR}`);
  console.log(`[server] Cursor SDK key: ${hasApiKey ? "configured" : "MISSING (演示模式)"}`);
  console.log(`[server] FAQ DB: ${isRemote ? "Turso (remote)" : "local file"}`);
  console.log(`[server] code FS: ${fsMode}`);
});
