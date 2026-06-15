import { Agent } from "@cursor/sdk";

export const config = { maxDuration: 30 };

// 轮询一次 cloud run 状态：完成则返回最终答案，否则快速返回 running。
// 注意：不要在这里调用 run.conversation()——它会阻塞直到运行结束（实测可达 90s），
// 会让轮询失去意义。进度展示交给前端的分阶段提示。
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
