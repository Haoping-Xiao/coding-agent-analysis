// 无 token 自检：验证 FAQ 数据库（本地 file 降级）+ 本机能读到 vendors/ 代码
// （local 运行时下 agent 会用内置工具读这里）。不需要任何外部凭证。
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { addFaq, listFaq, countFaq } from "./db.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");

let pass = 0, fail = 0;
function ok(name, cond, extra = "") {
  if (cond) { pass++; console.log("  ✓", name); }
  else { fail++; console.log("  ✗", name, extra); }
}

console.log("== FAQ DB（libSQL / 本地 file 降级） ==");
const before = await countFaq();
const row = await addFaq({ question: "自检问题？", answer: "自检答案。", model: "selftest" });
ok("addFaq 返回新行带 id", row && row.id > 0);
const after = await countFaq();
ok("countFaq 增加 1", after === before + 1, `(${before}->${after})`);
const items = await listFaq({ limit: 5 });
ok("listFaq 含刚插入的问题", items.some((i) => i.question === "自检问题？"));

console.log("== 代码仓（local 运行时 agent 的 cwd） ==");
ok("vendors/ 存在", existsSync(join(REPO_ROOT, "vendors")));
const vendors = readdirSync(join(REPO_ROOT, "vendors")).filter((n) => !n.startsWith("."));
ok("含 5 个 vendor", vendors.length >= 5, JSON.stringify(vendors));
const readme = join(REPO_ROOT, "vendors", "codex", "README.md");
ok("codex README 可读", existsSync(readme) && readFileSync(readme, "utf-8").length > 50);

console.log(`\n结果：${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
