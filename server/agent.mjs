// Cursor SDK 封装：基于 vendors/ 代码仓回答问题，面向小白、避免突兀术语。
// 没有 CURSOR_API_KEY 时进入「演示模式」，仍能跑通端到端 UX（但回答是占位内容）。
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
// 让本地 agent 在仓库根工作，这样它能读到 vendors/ 下各家源码。
const REPO_ROOT = process.env.AGENT_CWD || join(__dirname, "..");
const MODEL_ID = process.env.CURSOR_MODEL || "auto";
const API_KEY = process.env.CURSOR_API_KEY || "";

export const hasApiKey = Boolean(API_KEY);

// 给模型的角色与风格约束。
function buildPrompt(question) {
  return [
    "你是一个面向【编程小白 / 刚入门的 AI agent 开发者】的讲解助手。",
    "你的知识来源是本仓库 vendors/ 目录下 5 个真实开源 coding agent 的源码：",
    "Codex（vendors/codex）、Claude Code（vendors/claude-code-sourcemap）、",
    "Gemini CLI（vendors/gemini-cli）、OpenCode（vendors/opencode）、Kimi Code（vendors/kimi-code）。",
    "",
    "请遵守：",
    "1) 只读：阅读代码来回答，绝对不要修改、创建或删除任何文件。",
    "2) 通俗：用大白话和打比方解释，尽量避免突兀的术语；必须用术语时，先用一句话解释它。",
    "3) 有据：尽量点出结论来自哪个项目 / 哪个文件，但不要长篇贴源码。",
    "4) 简洁：3～6 句话讲清楚，结论先行。中文回答。",
    "",
    "用户的问题：",
    question,
  ].join("\n");
}

// 流式回答。onDelta(textChunk) 持续回调；返回 { answer, model, status }。
export async function askQuestion(question, onDelta) {
  const q = String(question || "").trim();
  if (!q) throw new Error("问题不能为空");

  if (!hasApiKey) {
    return mockAnswer(q, onDelta);
  }

  // 动态导入，避免没装依赖时整个进程起不来。
  const { Agent } = await import("@cursor/sdk");
  const agent = await Agent.create({
    apiKey: API_KEY,
    model: { id: MODEL_ID },
    local: {
      cwd: REPO_ROOT,
      autoReview: true, // 用 IDE 同款分类器兜底，降低 headless 误操作风险
    },
  });

  const run = await agent.send(buildPrompt(q));
  for await (const event of run.stream()) {
    if (event.type === "text" && event.text) {
      onDelta?.(event.text);
    }
  }
  const result = await run.wait();
  const answer = result.result || "";
  return {
    answer,
    model: (result.model && (result.model.id || String(result.model))) || MODEL_ID,
    status: result.status,
  };
}

// 演示模式：无 API key 时，流式吐出一段占位说明，证明前后端链路通畅。
async function mockAnswer(question, onDelta) {
  const text =
    "【演示模式 · 未配置 CURSOR_API_KEY】\n" +
    "这是一段占位回答，用来验证「提问 → 流式回答 → 采纳入库 → 回填网站」的完整链路。\n" +
    `你问的是：「${question}」。\n` +
    "配置好 CURSOR_API_KEY 后，这里会换成 Cursor SDK 基于 vendors/ 源码生成的真实讲解。";
  for (const chunk of text.match(/[\s\S]{1,8}/g) || []) {
    onDelta?.(chunk);
    await new Promise((r) => setTimeout(r, 18));
  }
  return { answer: text, model: "mock", status: "finished" };
}
