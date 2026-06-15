import { Agent } from "@cursor/sdk";
import { getEventsSince } from "./_lib.js";

export const config = { maxDuration: 20 };

// 轮询：返回运行状态 + 自 since 之后的新事件（实时进度）；完成时附最终答案。
export default async function handler(req, res) {
  const agentId = req.query.agentId;
  const runId = req.query.runId;
  const since = req.query.since || 0;
  if (!agentId || !runId) return res.status(400).json({ error: "需要 agentId 与 runId" });
  try {
    await Agent.resume(agentId);
    const run = await Agent.getRun(runId, { runtime: "cloud", agentId });
    const status = run.status;
    let events = [];
    try { events = await getEventsSince(runId, since); } catch (_) { /* ignore */ }
    if (status === "finished" || status === "error" || status === "cancelled") {
      const r = await run.wait();
      return res.status(200).json({
        status, events,
        answer: r.result || "",
        model: (r.model && (r.model.id || String(r.model))) || "",
      });
    }
    res.status(200).json({ status: status || "running", events });
  } catch (e) {
    res.status(500).json({ error: String(e && e.message || e) });
  }
}
