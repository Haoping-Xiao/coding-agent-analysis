// Cursor SDK 封装：基于代码仓回答问题，面向小白、避免突兀术语。
// 代码仓访问交给 Cursor SDK 自己：
//   - local 运行时：cwd 指向本仓库，agent 用内置工具直接读 vendors/（开发/自托管）。
//   - cloud 运行时：Cursor 起隔离 sandbox VM 把仓库 clone 进去，agent 在里面读代码
//     （部署首选；无需本机有 135MB 代码，也无需自建虚拟文件系统）。
// 没有 CURSOR_API_KEY 时进入「演示模式」，仍能跑通端到端 UX。
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = process.env.AGENT_CWD || join(__dirname, "..");

const MODEL_ID = process.env.CURSOR_MODEL || "auto";
const API_KEY = process.env.CURSOR_API_KEY || "";
// 运行时：local（默认，本机读 vendors/）或 cloud（Cursor sandbox 克隆仓库）。
const RUNTIME = (process.env.CURSOR_RUNTIME || "local").toLowerCase();
const REPO_URL = process.env.CURSOR_REPO_URL || "";
const REPO_REF = process.env.CURSOR_REPO_REF || "main";

export const hasApiKey = Boolean(API_KEY);
export const runtimeMode = RUNTIME === "cloud" ? "cloud (sandbox)" : "local";

function buildPrompt(question) {
  return [
    "你是一个面向【编程小白 / 刚入门的 AI agent 开发者】的讲解助手。",
    "当前工作目录是一个代码仓库，vendors/ 下有 5 个开源 coding agent 的源码：",
    "vendors/codex、vendors/claude-code-sourcemap、vendors/gemini-cli、vendors/opencode、vendors/kimi-code。",
    "请用你的文件工具（读取、列目录、搜索/grep）查阅这些源码来回答，不要凭空假设，也不要修改任何文件。",
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

async function createAgent(Agent) {
  if (RUNTIME === "cloud") {
    if (!REPO_URL) throw new Error("cloud 运行时需要设置 CURSOR_REPO_URL（要 clone 的仓库地址）");
    return Agent.create({
      apiKey: API_KEY,
      model: { id: MODEL_ID },
      cloud: { repos: [{ url: REPO_URL, startingRef: REPO_REF }] },
    });
  }
  // local：让 agent 在本仓库根工作，用内置工具读 vendors/。
  return Agent.create({
    apiKey: API_KEY,
    model: { id: MODEL_ID },
    local: { cwd: REPO_ROOT, autoReview: true },
  });
}

export async function askQuestion(question, onDelta) {
  const q = String(question || "").trim();
  if (!q) throw new Error("问题不能为空");
  if (!hasApiKey) return mockAnswer(q, onDelta);

  const { Agent } = await import("@cursor/sdk");
  const agent = await createAgent(Agent);

  const run = await agent.send(buildPrompt(q));
  for await (const event of run.stream()) {
    if (event.type === "text" && event.text) onDelta?.(event.text);
    // cloud 运行时 VM provisioning/cloning 会先发 status 事件，可选择透传给前端做进度提示
    else if (event.type === "status" && event.status) {
      onDelta?.("");
    }
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
    `当前运行时：${runtimeMode}。\n` +
    "配置好 CURSOR_API_KEY 后，这里会换成 Cursor SDK 读取 vendors/ 源码生成的真实讲解。";
  for (const chunk of text.match(/[\s\S]{1,8}/g) || []) {
    onDelta?.(chunk);
    await new Promise((r) => setTimeout(r, 16));
  }
  return { answer: text, model: "mock", status: "finished" };
}
