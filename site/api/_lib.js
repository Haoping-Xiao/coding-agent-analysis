// Vercel serverless 共享代码：Turso 客户端、cloud 仓库配置、问答 prompt。
import { createClient } from "@libsql/client";

let _db;
export function db() {
  if (!_db) {
    _db = createClient({
      url: process.env.TURSO_DATABASE_URL,
      authToken: process.env.TURSO_AUTH_TOKEN,
    });
  }
  return _db;
}

export async function ensureSchema() {
  await db().executeMultiple(`
    CREATE TABLE IF NOT EXISTS faq (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      question TEXT NOT NULL,
      answer TEXT NOT NULL,
      model TEXT,
      upvotes INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'published',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

export const MODEL_ID = process.env.CURSOR_MODEL || "auto";

// Cursor cloud sandbox 要 clone 的仓库（已连接到团队的 vendor 源码 fork）。
// gemini-cli 暂未 fork/连接，如需覆盖请在 GitHub fork 后连接到 Cursor 团队再加入此列表。
export const REPOS = [
  { url: "https://github.com/Haoping-Xiao/codex", startingRef: "main" },
  { url: "https://github.com/Haoping-Xiao/opencode", startingRef: "dev" },
  { url: "https://github.com/Haoping-Xiao/kimi-code", startingRef: "main" },
  { url: "https://github.com/Haoping-Xiao/claude-code-sourcemap", startingRef: "main" },
];

export function buildPrompt(question) {
  return [
    "你是一个面向【编程小白 / 刚入门的 AI agent 开发者】的讲解助手。",
    "当前 workspace 里 clone 了几个开源 coding agent 的源码仓库（各自一个目录）：",
    "codex、opencode、kimi-code、claude-code-sourcemap。先用文件工具（list_dir/read_file/grep 或终端）浏览，再据此回答。",
    "请只通过阅读这些源码来回答，不要凭空假设，也不要修改任何文件。",
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

export function readBody(req) {
  // Vercel 在 application/json 时通常已解析 req.body；兜底手动解析。
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") { try { return JSON.parse(req.body); } catch { return {}; } }
  return {};
}
