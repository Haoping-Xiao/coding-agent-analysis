import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const raw = readFileSync(join(root, "site", "data.js"), "utf8");
const code = raw
  .replace(/^\/\*[\s\S]*?\*\/\s*/, "")
  .replace(/^window\.SITE_DATA\s*=\s*/, "SITE_DATA = ");

const sandbox = {};
vm.runInNewContext(code, sandbox);
const d = sandbox.SITE_DATA;
if (!d) throw new Error("SITE_DATA 未解析");

const vendors = ["codex", "claude", "gemini", "opencode", "kimi"];
if (!Array.isArray(d.loop) || d.loop.length < 5) throw new Error("loop 步骤不足");
for (const k of vendors) {
  const v = d.vendors?.[k];
  if (!v?.tag || !v?.summary) throw new Error(`vendors.${k} 缺 tag/summary`);
  if (!Array.isArray(v.tricks) || v.tricks.length < 3) throw new Error(`vendors.${k} tricks 不足`);
}
if (!Array.isArray(d.compare) || d.compare.length < 5) throw new Error("compare 表行不足");
const sig = d.compare.find((r) => r[0] === "招牌绝活");
if (!sig || sig.length !== 6) throw new Error("compare 缺招牌绝活行");

console.log("  ✓ data.js 结构 OK（5 家 vendor + compare）");
