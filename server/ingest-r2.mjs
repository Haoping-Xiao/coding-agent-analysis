// 一次性脚本：把 vendors/ 代码仓灌进 Cloudflare R2 + 在 Turso 建行索引（供 grep）。
// 需要环境变量：R2_BUCKET / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / (CLOUDFLARE_ACCOUNT_ID 或 R2_ENDPOINT)
//              以及 TURSO_DATABASE_URL / TURSO_AUTH_TOKEN（grep 行索引）。
// 用法：node ingest-r2.mjs [子目录，默认 vendors]
import { readdirSync, statSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import db, { isRemote } from "./db.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const SUBDIR = process.argv[2] || "vendors";
const BUCKET = process.env.R2_BUCKET;

if (!BUCKET || !process.env.R2_ACCESS_KEY_ID) {
  console.error("缺少 R2 配置（R2_BUCKET / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY）。");
  process.exit(1);
}
if (!isRemote) {
  console.error("缺少 Turso 配置（TURSO_DATABASE_URL / TURSO_AUTH_TOKEN），grep 行索引需要它。");
  process.exit(1);
}

const endpoint = process.env.R2_ENDPOINT ||
  `https://${process.env.CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`;
const s3 = new S3Client({
  region: "auto",
  endpoint,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

const SKIP_DIR = /(^|\/)(\.git|node_modules|dist|build|target|\.next)(\/|$)/;
const TEXT_EXT = /\.(rs|ts|tsx|js|jsx|mjs|cjs|json|md|toml|yaml|yml|py|go|sh|txt|css|html|sql|lock)$/i;
const MAX_FILE = 512 * 1024;

function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name);
    const rel = relative(ROOT, abs);
    if (SKIP_DIR.test("/" + rel)) continue;
    let st; try { st = statSync(abs); } catch { continue; }
    if (st.isDirectory()) walk(abs, acc);
    else if (st.isFile() && st.size <= MAX_FILE && TEXT_EXT.test(name)) acc.push({ abs, rel, size: st.size });
  }
  return acc;
}

async function main() {
  console.log(`[ingest] scanning ${SUBDIR} …`);
  const files = walk(join(ROOT, SUBDIR));
  console.log(`[ingest] ${files.length} text files`);

  // 目录树（list_dir 用）
  const tree = {};
  function addToTree(rel, type) {
    const parts = rel.split("/");
    const parent = parts.slice(0, -1).join("/") || ".";
    (tree[parent] ||= []);
    if (!tree[parent].some((e) => e.name === parts[parts.length - 1]))
      tree[parent].push({ name: parts[parts.length - 1], type });
  }

  // 重建行索引表
  await db.executeMultiple(`
    DROP TABLE IF EXISTS code_lines;
    CREATE TABLE code_lines (path TEXT, line INTEGER, text TEXT);
  `);

  let uploaded = 0, lines = 0, batch = [];
  for (const f of files) {
    const key = "files/" + f.rel;
    const content = readFileSync(f.abs, "utf-8");
    await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: content, ContentType: "text/plain; charset=utf-8" }));
    uploaded++;

    // 目录树：把路径上每一层登记
    const segs = f.rel.split("/");
    for (let i = 1; i < segs.length; i++) addToTree(segs.slice(0, i + 1).join("/"), i === segs.length - 1 ? "file" : "dir");

    // 行索引
    const fileLines = content.split("\n");
    for (let i = 0; i < fileLines.length; i++) {
      const t = fileLines[i];
      if (!t.trim()) continue;
      batch.push({ sql: "INSERT INTO code_lines (path,line,text) VALUES (?,?,?)", args: [f.rel, i + 1, t.slice(0, 500)] });
      lines++;
      if (batch.length >= 500) { await db.batch(batch); batch = []; }
    }
    if (uploaded % 50 === 0) console.log(`[ingest] ${uploaded}/${files.length} files, ${lines} lines`);
  }
  if (batch.length) await db.batch(batch);

  await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: "tree.json", Body: JSON.stringify(tree), ContentType: "application/json" }));
  await db.executeMultiple("CREATE INDEX IF NOT EXISTS idx_code_lines_path ON code_lines(path);");

  console.log(`[ingest] done: ${uploaded} files uploaded, ${lines} lines indexed.`);
  process.exit(0);
}

main().catch((e) => { console.error("[ingest] failed:", e); process.exit(1); });
