import { Agent } from "@cursor/sdk";

export const config = { maxDuration: 30 };

// 把工具调用整理成一句人话标签，给前端做「实时进度」展示。
function toolLabel(m) {
  var a = (m && m.args) || {};
  var ty = (m && m.type) || "tool";
  if (ty === "grep") return "搜索 “" + (a.pattern || "") + "”";
  if (ty === "read_file" || ty === "read") return "读取 " + (a.path || a.target || a.relativePath || "");
  if (ty === "list_dir") return "浏览目录 " + (a.path || a.relativePath || ".");
  if (ty === "run_terminal_cmd" || ty === "terminal") return "执行 " + String(a.command || "").slice(0, 50);
  if (ty === "file_search" || ty === "codebase_search" || ty === "glob") return "查找 " + (a.query || a.pattern || a.globPattern || "");
  if (ty === "web_search") return "联网搜索 " + (a.query || "");
  return ty;
}

// 从 conversation() 里提取最近若干步（思考 / 工具调用），给前端滚动展示。
function summarizeSteps(conv) {
  if (!Array.isArray(conv) || !conv.length) return [];
  var turn = conv[conv.length - 1] && conv[conv.length - 1].turn;
  var steps = (turn && turn.steps) || [];
  var out = [];
  for (var i = 0; i < steps.length; i++) {
    var s = steps[i];
    if (s.type === "assistantMessage") {
      var t = ((s.message && s.message.text) || "").trim().split("\n")[0];
      if (t) out.push({ k: "think", t: t.slice(0, 90) });
    } else if (s.type === "toolCall") {
      out.push({ k: "tool", t: toolLabel(s.message) });
    }
  }
  return out.slice(-10);
}

// 轮询一次 cloud run：完成则返回最终答案；进行中则返回实时进度步骤。
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
    let steps = [];
    try { steps = summarizeSteps(await run.conversation()); } catch (e) { /* 进度是尽力而为 */ }
    res.status(200).json({ status: status || "running", steps });
  } catch (e) {
    res.status(500).json({ error: String(e && e.message || e) });
  }
}
