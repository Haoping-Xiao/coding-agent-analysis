// 无 token 自检：验证 FAQ 数据库（本地 file 降级）+ 虚拟 FS 工具（LocalFs）逻辑。
// 不需要任何外部凭证；用于本地/CI 快速回归。
import { addFaq, listFaq, countFaq } from "./db.mjs";
import { createFsProvider } from "./fs/provider.mjs";
import { buildCustomTools } from "./fs/tools.mjs";

let pass = 0, fail = 0;
function ok(name, cond, extra = "") {
  if (cond) { pass++; console.log("  ✓", name); }
  else { fail++; console.log("  ✗", name, extra); }
}

console.log("== FAQ DB ==");
const before = await countFaq();
const row = await addFaq({ question: "自检问题？", answer: "自检答案。", model: "selftest" });
ok("addFaq 返回新行带 id", row && row.id > 0);
const after = await countFaq();
ok("countFaq 增加 1", after === before + 1, `(${before}->${after})`);
const items = await listFaq({ limit: 5 });
ok("listFaq 含刚插入的问题", items.some((i) => i.question === "自检问题？"));

console.log("== 虚拟 FS 工具（LocalFs） ==");
const fs = createFsProvider();
ok("provider mode = local-fs（无 R2 配置时）", fs.mode === "local-fs", `(got ${fs.mode})`);
const tools = buildCustomTools(fs);

const ls = JSON.parse(await tools.list_dir.execute({ path: "vendors" }));
ok("list_dir vendors 含 codex", ls.some((e) => e.name === "codex" && e.type === "dir"), JSON.stringify(ls));

const readme = await tools.read_file.execute({ path: "vendors/codex/README.md" });
ok("read_file 读到 codex README 非空", typeof readme === "string" && readme.length > 50);

const hits = JSON.parse(await tools.grep.execute({ pattern: "Submission", glob: "*.rs" }));
ok("grep 在 .rs 里命中 Submission", Array.isArray(hits) && hits.length > 0, `(hits=${hits.length})`);
if (hits[0]) console.log("    e.g.", hits[0].path + ":" + hits[0].line);

const escaped = await tools.read_file.execute({ path: "../../../etc/passwd" });
ok("read_file 拦截路径越界", typeof escaped === "string" && escaped.startsWith("读取失败"), escaped.slice(0, 40));

console.log(`\n结果：${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
