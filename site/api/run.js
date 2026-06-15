import { Agent } from "@cursor/sdk";

export const config = { maxDuration: 30 };

// 轮询一次 cloud run 的状态；完成则返回最终答案。
export default async function handler(req, res) {
  const agentId = req.query.agentId;
  const runId = req.query.runId;
  if (!agentId || !runId) return res.status(400).json({ error: "需要 agentId 与 runId" });
  try {
    await Agent.resume(agentId);
    const run = await Agent.getRun(runId, { runtime: "cloud", agentId });
    const status = run.status;
    if (status === "finished" || status === "error" || status === "cancelled") {
      const r = await run.wait();
      return res.status(200).json({
        status,
        answer: r.result || "",
        model: (r.model && (r.model.id || String(r.model))) || "",
      });
    }
    res.status(200).json({ status: status || "running" });
  } catch (e) {
    res.status(500).json({ error: String(e && e.message || e) });
  }
}
