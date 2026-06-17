// 预热单例 cloud agent：新建一个 agent、让它把仓库 clone 好，把 agentId 存进 Turso。
// 之后线上 /api/ask 会一直 resume 这个 agent（沙箱已就绪 → 提问更快、实时步骤能落在 60s 内）。
//
// 依赖环境变量：CURSOR_API_KEY、TURSO_DATABASE_URL、TURSO_AUTH_TOKEN
// 用法：node server/warm-agent.mjs        # 预热并写入 warm_agent_id
//       node server/warm-agent.mjs --reset # 同上（每次都新建，等于重置对话上下文）
import { Agent } from "@cursor/sdk";
import { createClient } from "@libsql/client";

// 注意：要与 site/api/_lib.js 的 REPOS 保持一致。
const REPOS = [
  { url: "https://github.com/Haoping-Xiao/codex", startingRef: "main" },
  { url: "https://github.com/Haoping-Xiao/opencode", startingRef: "dev" },
  { url: "https://github.com/Haoping-Xiao/kimi-code", startingRef: "main" },
  { url: "https://github.com/Haoping-Xiao/claude-code-sourcemap", startingRef: "main" },
  { url: "https://github.com/Haoping-Xiao/gemini-cli", startingRef: "main" },
];

if (!process.env.CURSOR_API_KEY) { console.error("缺少 CURSOR_API_KEY"); process.exit(1); }
if (!process.env.TURSO_DATABASE_URL) { console.error("缺少 TURSO_DATABASE_URL / TURSO_AUTH_TOKEN"); process.exit(1); }

const db = createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN });
await db.executeMultiple(`CREATE TABLE IF NOT EXISTS app_state (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT NOT NULL DEFAULT (datetime('now')));`);

console.log("[warm] 新建 cloud agent 并克隆仓库…");
const t0 = Date.now();
const agent = await Agent.create({
  apiKey: process.env.CURSOR_API_KEY,
  model: { id: process.env.CURSOR_MODEL || "auto" },
  cloud: { repos: REPOS },
});
// 触发一次最小运行，确保 5 个仓库都 clone 到沙箱
const run = await agent.send("ls 一下 workspace 根目录，只回 OK。");
await run.wait();

await db.execute({
  sql: "INSERT INTO app_state (key, value, updated_at) VALUES ('warm_agent_id', ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')",
  args: [agent.agentId],
});
console.log(`[warm] 完成（${((Date.now() - t0) / 1000).toFixed(0)}s）→ warm_agent_id = ${agent.agentId}`);
process.exit(0);
