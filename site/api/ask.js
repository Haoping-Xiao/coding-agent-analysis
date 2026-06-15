import { Agent } from "@cursor/sdk";
import { REPOS, MODEL_ID, buildPrompt, readBody } from "./_lib.js";

export const config = { maxDuration: 60 };

// 启动一次 cloud 运行（Cursor sandbox 克隆 vendor 仓库 + agent 读代码），
// 立即返回 { agentId, runId }；前端再轮询 /api/run 取结果（cloud 跑完通常 30~60s）。
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const { question } = readBody(req);
  if (!String(question || "").trim()) return res.status(400).json({ error: "question 不能为空" });
  if (!process.env.CURSOR_API_KEY) return res.status(500).json({ error: "服务端未配置 CURSOR_API_KEY" });

  try {
    const agent = await Agent.create({
      apiKey: process.env.CURSOR_API_KEY,
      model: { id: MODEL_ID },
      cloud: { repos: REPOS },
    });
    const run = await agent.send(buildPrompt(question));
    res.status(200).json({ mode: "async", agentId: agent.agentId, runId: run.id });
  } catch (e) {
    res.status(500).json({ error: String(e && e.message || e), name: e && e.name });
  }
}
