// 定期运行：把 FAQ 数据库导出成 site/faq.json，让静态网站（含 Vercel 部署）
// 无需后端也能展示日益丰富的常见问答。可配合 cron / CI 定时执行。
//   node server/export-faq.mjs
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { listFaq } from "./db.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = process.env.FAQ_JSON_PATH || join(__dirname, "..", "site", "faq.json");

const items = listFaq({ limit: 500 });
const payload = {
  generated_at: new Date().toISOString(),
  count: items.length,
  items,
};

writeFileSync(OUT, JSON.stringify(payload, null, 2) + "\n", "utf-8");
console.log(`[export-faq] wrote ${items.length} item(s) -> ${OUT}`);
