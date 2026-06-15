import { Agent } from "@cursor/sdk";
import { waitUntil } from "@vercel/functions";
import { REPOS, MODEL_ID, buildPrompt, readBody, ensureSchema, insertEvent, phaseLabel, toolArgLabel, isAdmin, getState, setState } from "./_lib.js";

export const config = { maxDuration: 60 };

const WARM_KEY = "warm_agent_id";

// 取得「单例温 agent」：优先 resume 已存在的（沙箱已克隆代码，快，warm=true）；
// 没有或失效则新建并记下（需要克隆，warm=false）。
async function getWarmAgent() {
  const existing = await getState(WARM_KEY);
  if (existing) {
    try {
      const a = await Agent.resume(existing, { apiKey: process.env.CURSOR_API_KEY });
      return { agent: a, warm: true };
    } catch (_) { /* 失效则下面重建 */ }
  }
  const a = await Agent.create({
    apiKey: process.env.CURSOR_API_KEY,
    model: { id: MODEL_ID },
    cloud: { repos: REPOS },
  });
  await setState(WARM_KEY, a.agentId);
  return { agent: a, warm: false };
}

// 后台消费 run.stream()，把状态/思考/工具调用写进 run_events 供前端实时展示。
async function consumeStream(run, runId) {
  let lastThink = 0, answering = false;
  try {
    for await (const ev of run.stream()) {
      if (ev.type === "status" && ev.status) {
        await insertEvent(runId, { kind: "status", status: ev.status, label: phaseLabel(ev.status) });
      } else if (ev.type === "tool_call") {
        await insertEvent(runId, { kind: "tool", call_id: ev.call_id || (ev.name + ""), name: ev.name, label: toolArgLabel(ev.name, ev.args), status: ev.status || "running" });
      } else if (ev.type === "thinking") {
        const now = Date.now(); const t = (ev.text || "").trim();
        if (t && now - lastThink > 1500) { lastThink = now; const line = t.split("\n").filter(Boolean).pop() || t; await insertEvent(runId, { kind: "thinking", label: line.slice(0, 90) }); }
      } else if (ev.type === "assistant") {
        if (!answering) { answering = true; await insertEvent(runId, { kind: "answering", label: "正在组织答案" }); }
      }
    }
  } catch (_) { /* 流中断不影响最终答案 */ }
}

// 管理员发起一次提问：复用单例温 agent，立即返回 {agentId, runId}，前端轮询 /api/run。
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  if (!isAdmin(req)) return res.status(401).json({ error: "仅管理员可提问" });
  const { question } = readBody(req);
  if (!String(question || "").trim()) return res.status(400).json({ error: "question 不能为空" });
  if (!process.env.CURSOR_API_KEY) return res.status(500).json({ error: "服务端未配置 CURSOR_API_KEY" });

  try {
    await ensureSchema();
    const { agent, warm } = await getWarmAgent();
    const run = await agent.send(buildPrompt(question));
    waitUntil(consumeStream(run, run.id));
    res.status(200).json({ mode: "async", agentId: agent.agentId, runId: run.id, warm: warm });
  } catch (e) {
    const msg = String(e && e.message || e);
    // 单例 agent 正忙（上一次还没跑完）
    if (/busy/i.test(msg) || (e && e.name === "AgentBusyError")) {
      return res.status(409).json({ error: "上一个问题还在跑，请稍候再问（单例 agent）" });
    }
    res.status(500).json({ error: msg, name: e && e.name });
  }
}
