// Cursor SDK 封装：基于代码仓回答问题，面向小白、避免突兀术语。
// 代码仓通过「虚拟文件系统 + customTools」访问（见 fs/provider.mjs、fs/tools.mjs），
// 这样无论 vendors/ 在本地磁盘还是在 R2，agent 都用同一套工具读取。
// 没有 CURSOR_API_KEY 时进入「演示模式」，仍能跑通端到端 UX。
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createFsProvider } from "./fs/provider.mjs";
import { buildCustomTools } from "./fs/tools.mjs";

const MODEL_ID = process.env.CURSOR_MODEL || "auto";
const API_KEY = process.env.CURSOR_API_KEY || "";

export const hasApiKey = Boolean(API_KEY);

const fsProvider = createFsProvider();
export const fsMode = fsProvider.mode;

// 给 agent 一个空的工作目录：强制它通过我们的 customTools（虚拟 FS）访问代码，
// 而不是去读真实磁盘——这样线上无持久 FS 时行为一致。
const EMPTY_CWD = join(tmpdir(), "coding-agent-faq-cwd");
mkdirSync(EMPTY_CWD, { recursive: true });

function buildPrompt(question) {
  return [
    "你是一个面向【编程小白 / 刚入门的 AI agent 开发者】的讲解助手。",
    "你能通过以下工具访问一个代码仓库（5 个开源 coding agent 的源码，位于 vendors/ 下）：",
    "- list_dir(path)：列目录；- read_file(path)：读文件；- grep(pattern, glob?)：搜代码。",
    "请【只通过这些工具】查阅代码来回答，不要假设文件内容，也不要修改任何文件。",
    "代码仓结构：vendors/codex、vendors/claude-code-sourcemap、vendors/gemini-cli、",
    "vendors/opencode、vendors/kimi-code。",
    "",
    "回答要求：",
    "1) 通俗：用大白话和打比方，尽量避免突兀术语；必须用术语时先一句话解释。",
    "2) 有据：点出结论来自哪个项目/文件，但不要长篇贴源码。",
    "3) 简洁：3～6 句话，结论先行，中文回答。",
    "",
    "用户的问题：",
    question,
  ].join("\n");
}

export async function askQuestion(question, onDelta) {
  const q = String(question || "").trim();
  if (!q) throw new Error("问题不能为空");
  if (!hasApiKey) return mockAnswer(q, onDelta);

  const { Agent } = await import("@cursor/sdk");
  const agent = await Agent.create({
    apiKey: API_KEY,
    model: { id: MODEL_ID },
    local: {
      cwd: EMPTY_CWD,
      customTools: buildCustomTools(fsProvider),
      autoReview: true,
    },
  });

  const run = await agent.send(buildPrompt(q));
  for await (const event of run.stream()) {
    if (event.type === "text" && event.text) onDelta?.(event.text);
  }
  const result = await run.wait();
  return {
    answer: result.result || "",
    model: (result.model && (result.model.id || String(result.model))) || MODEL_ID,
    status: result.status,
  };
}

async function mockAnswer(question, onDelta) {
  const text =
    "【演示模式 · 未配置 CURSOR_API_KEY】\n" +
    "这是一段占位回答，用来验证「提问 → 流式回答 → 采纳入库 → 回填网站」的完整链路。\n" +
    `你问的是：「${question}」。\n` +
    `当前代码访问方式：${fsMode}。\n` +
    "配置好 CURSOR_API_KEY 后，这里会换成 Cursor SDK 通过虚拟文件系统读取 vendors/ 源码生成的真实讲解。";
  for (const chunk of text.match(/[\s\S]{1,8}/g) || []) {
    onDelta?.(chunk);
    await new Promise((r) => setTimeout(r, 16));
  }
  return { answer: text, model: "mock", status: "finished" };
}
