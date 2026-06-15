import { Agent } from "@cursor/sdk";
import { waitUntil } from "@vercel/functions";
import { REPOS, MODEL_ID, buildPrompt, readBody, ensureSchema, insertEvent, phaseLabel, toolArgLabel } from "./_lib.js";

export const config = { maxDuration: 60 };

// 后台消费 run.stream()，把状态/思考/工具调用写进 run_events，供前端实时展示。
// 用 waitUntil 让函数在返回响应后继续跑（最长到 maxDuration）。超时也无妨：
// 最终答案由 /api/run 通过 getRun 取回，进度只是尽力而为。
async function consumeStream(run, runId) {
  let lastThink = 0;
  let answering = false;
  try {
    for await (const ev of run.stream()) {
      if (ev.type === "status" && ev.status) {
        await insertEvent(runId, { kind: "status", status: ev.status, label: phaseLabel(ev.status) });
      } else if (ev.type === "tool_call") {
        await insertEvent(runId, {
          kind: "tool", call_id: ev.call_id || (ev.name + ""), name: ev.name,
          label: toolArgLabel(ev.name, ev.args), status: ev.status || "running",
        });
      } else if (ev.type === "thinking") {
        const now = Date.now();
        const t = (ev.text || "").trim();
        if (t && now - lastThink > 1500) {
          lastThink = now;
          const line = t.split("\n").filter(Boolean).pop() || t;
          await insertEvent(runId, { kind: "thinking", label: line.slice(0, 90) });
        }
      } else if (ev.type === "assistant") {
        if (!answering) { answering = true; await insertEvent(runId, { kind: "answering", label: "正在组织答案" }); }
      }
    }
  } catch (_) { /* 流中断不影响最终答案获取 */ }
}

// 启动一次 cloud 运行，立即返回 {agentId, runId}；前端轮询 /api/run。
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const { question } = readBody(req);
  if (!String(question || "").trim()) return res.status(400).json({ error: "question 不能为空" });
  if (!process.env.CURSOR_API_KEY) return res.status(500).json({ error: "服务端未配置 CURSOR_API_KEY" });

  try {
    await ensureSchema();
    const agent = await Agent.create({
      apiKey: process.env.CURSOR_API_KEY,
      model: { id: MODEL_ID },
      cloud: { repos: REPOS },
    });
    const run = await agent.send(buildPrompt(question));
    // 后台流式消费（返回响应后继续）
    waitUntil(consumeStream(run, run.id));
    res.status(200).json({ mode: "async", agentId: agent.agentId, runId: run.id });
  } catch (e) {
    res.status(500).json({ error: String(e && e.message || e), name: e && e.name });
  }
}
