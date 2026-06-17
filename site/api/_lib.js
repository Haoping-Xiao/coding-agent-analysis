// Vercel serverless 共享代码：Turso 客户端、cloud 仓库配置、问答 prompt、管理员鉴权、温 agent 状态。
import { createClient } from "@libsql/client";
import crypto from "node:crypto";

// ===== 管理员鉴权（账号/密码默认 hopkinx，可用环境变量覆盖）=====
const ADMIN_USER = process.env.ADMIN_USERNAME || "hopkinx";
const ADMIN_PASS = process.env.ADMIN_PASSWORD || "hopkinx";
const ADMIN_SECRET = process.env.ADMIN_SECRET || "coding-agents-101-secret";

export function adminToken() {
  return crypto.createHmac("sha256", ADMIN_SECRET).update("admin:" + ADMIN_USER).digest("hex");
}
export function checkLogin(username, password) {
  return username === ADMIN_USER && password === ADMIN_PASS;
}
export function isAdmin(req) {
  var h = (req.headers && (req.headers.authorization || req.headers.Authorization)) || "";
  var t = String(h).replace(/^Bearer\s+/i, "").trim();
  return Boolean(t) && t === adminToken();
}
export function adminName() { return ADMIN_USER; }

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
    CREATE TABLE IF NOT EXISTS run_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      call_id TEXT,
      name TEXT,
      label TEXT,
      status TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_run_events_run ON run_events(run_id, id);
    CREATE TABLE IF NOT EXISTS app_state (
      key TEXT PRIMARY KEY,
      value TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS chat_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      question TEXT NOT NULL,
      answer TEXT NOT NULL,
      model TEXT,
      steps TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS faq_comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      faq_id INTEGER NOT NULL,
      author TEXT,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_faq_comments_faq ON faq_comments(faq_id, id);
  `);
}

export async function getState(key) {
  const r = await db().execute({ sql: "SELECT value FROM app_state WHERE key = ?", args: [key] });
  return r.rows[0] ? r.rows[0].value : null;
}
export async function setState(key, value) {
  await db().execute({
    sql: "INSERT INTO app_state (key, value, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')",
    args: [key, value],
  });
}

// 把 run.stream() 的一条事件写进 run_events，供前端轮询展示实时状态。
export async function insertEvent(runId, e) {
  try {
    await db().execute({
      sql: "INSERT INTO run_events (run_id, kind, call_id, name, label, status) VALUES (?,?,?,?,?,?)",
      args: [runId, e.kind, e.call_id || null, e.name || null, (e.label || "").slice(0, 200), e.status || null],
    });
  } catch (_) { /* 进度是尽力而为，写失败不影响主流程 */ }
}

export async function getEventsSince(runId, sinceId) {
  const r = await db().execute({
    sql: "SELECT id, kind, call_id, name, label, status FROM run_events WHERE run_id = ? AND id > ? ORDER BY id ASC LIMIT 200",
    args: [runId, Number(sinceId) || 0],
  });
  return r.rows;
}

// cloud status → 中文阶段名
export function phaseLabel(s) {
  var m = { CREATING: "准备云端沙箱、克隆代码仓", RUNNING: "在源码里查阅、思考", FINISHED: "完成", ERROR: "出错", CANCELLED: "已取消", EXPIRED: "已过期" };
  return m[s] || s || "运行中";
}

// 工具名 + 原始 args → 「动词 + 关键参数」中文标签
export function toolArgLabel(name, args) {
  var a = args || {};
  var n = String(name || "").toLowerCase();
  var arg = a.target_file || a.path || a.relative_workspace_path || a.pattern || a.query ||
    a.command || a.search_term || a.glob_pattern || a.url || "";
  arg = String(arg).slice(0, 80);
  var verb;
  if (/read/.test(n)) verb = "读取";
  else if (/list|dir/.test(n)) verb = "浏览目录";
  else if (/grep/.test(n)) verb = "搜索";
  else if (/codebase|semantic/.test(n)) verb = "语义检索";
  else if (/file_search|glob|find/.test(n)) verb = "查找文件";
  else if (/terminal|shell|exec|bash|run/.test(n)) verb = "执行命令";
  else if (/edit|write|apply_patch|patch/.test(n)) verb = "编辑文件";
  else if (/web_search|web/.test(n)) verb = "联网搜索";
  else verb = name || "工具";
  return arg ? verb + " " + arg : verb;
}

export const MODEL_ID = process.env.CURSOR_MODEL || "auto";

// Cursor cloud sandbox 要 clone 的仓库（已连接到团队的 vendor 源码 fork）。
// 这些 fork 由 scripts/sync-forks.sh 在部署前同步到各自上游最新。
export const REPOS = [
  { url: "https://github.com/Haoping-Xiao/codex", startingRef: "main" },
  { url: "https://github.com/Haoping-Xiao/opencode", startingRef: "dev" },
  { url: "https://github.com/Haoping-Xiao/kimi-code", startingRef: "main" },
  { url: "https://github.com/Haoping-Xiao/claude-code-sourcemap", startingRef: "main" },
  { url: "https://github.com/Haoping-Xiao/gemini-cli", startingRef: "main" },
];

export function buildPrompt(question) {
  return [
    "你是一个面向【编程小白 / 刚入门的 AI agent 开发者】的讲解助手。",
    "当前 workspace 里 clone 了几个开源 coding agent 的源码仓库（各自一个目录）：",
    "codex、opencode、kimi-code、claude-code-sourcemap、gemini-cli。先用文件工具（list_dir/read_file/grep 或终端）浏览，再据此回答。",
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
