// 虚拟文件系统抽象：让 agent 通过统一接口访问代码仓，底层可换。
//   - LocalFsProvider：直接读真实磁盘上的仓库（本地开发 / 有持久 FS 的主机）。
//   - R2Provider：从 Cloudflare R2 读对象，grep 走 Turso 行索引（无持久 FS 的 serverless）。
// 接口：{ mode, readFile(path), listDir(path), grep(pattern, {glob,max}) }
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, normalize, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = process.env.AGENT_CWD || join(__dirname, "..", "..");

// 安全：把外部传入的相对路径限制在 root 内，禁止 .. 逃逸。
function safeJoin(root, p) {
  const clean = normalize(String(p || "").replace(/^[/\\]+/, ""));
  const full = join(root, clean);
  const rel = relative(root, full);
  if (rel.startsWith("..") || rel.includes(".." + sep)) {
    throw new Error("路径越界：" + p);
  }
  return full;
}

/* ============== 本地真实文件系统 ============== */
class LocalFsProvider {
  constructor(root = REPO_ROOT) {
    this.root = root;
    this.mode = "local-fs";
  }
  async readFile(path) {
    const full = safeJoin(this.root, path);
    return readFileSync(full, "utf-8");
  }
  async listDir(path = ".") {
    const full = safeJoin(this.root, path);
    return readdirSync(full, { withFileTypes: true })
      .filter((d) => !d.name.startsWith(".git"))
      .map((d) => ({ name: d.name, type: d.isDirectory() ? "dir" : "file" }));
  }
  async grep(pattern, { glob, max = 50 } = {}) {
    // 优先用 ripgrep（快、准）；不可用时退化为有界的 JS 扫描。
    const rg = spawnSync(
      "rg",
      [
        "--no-heading", "--line-number", "--color=never",
        "--max-count", "5", "-m", String(max),
        ...(glob ? ["-g", glob] : []),
        "-e", pattern, ".",
      ],
      { cwd: this.root, encoding: "utf-8", maxBuffer: 8 * 1024 * 1024 }
    );
    if (!rg.error && typeof rg.stdout === "string") {
      return rg.stdout
        .split("\n").filter(Boolean).slice(0, max)
        .map((line) => {
          const m = line.match(/^(.*?):(\d+):(.*)$/);
          return m ? { path: m[1].replace(/^\.\//, ""), line: Number(m[2]), text: m[3] } : { path: line, line: 0, text: "" };
        });
    }
    return jsGrep(this.root, pattern, max);
  }
}

// ripgrep 不可用时的兜底：有界递归 + 正则。
function jsGrep(root, pattern, max) {
  let re;
  try { re = new RegExp(pattern, "i"); } catch { re = new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"); }
  const out = [];
  const stack = ["."];
  let visited = 0;
  while (stack.length && out.length < max && visited < 8000) {
    const rel = stack.pop();
    const abs = join(root, rel);
    let st; try { st = statSync(abs); } catch { continue; }
    if (st.isDirectory()) {
      if (/(^|\/)(\.git|node_modules)$/.test(rel)) continue;
      for (const name of readdirSync(abs)) stack.push(rel === "." ? name : rel + "/" + name);
    } else if (st.isFile() && st.size < 512 * 1024) {
      visited++;
      let txt; try { txt = readFileSync(abs, "utf-8"); } catch { continue; }
      const lines = txt.split("\n");
      for (let i = 0; i < lines.length && out.length < max; i++) {
        if (re.test(lines[i])) out.push({ path: rel, line: i + 1, text: lines[i].slice(0, 300) });
      }
    }
  }
  return out;
}

/* ============== Cloudflare R2（S3 兼容）+ Turso 行索引 ============== */
class R2Provider {
  constructor() {
    this.mode = "r2";
    this.bucket = process.env.R2_BUCKET;
    this._s3 = null;
    this._db = null;
  }
  async _s3client() {
    if (this._s3) return this._s3;
    const { S3Client } = await import("@aws-sdk/client-s3");
    const endpoint = process.env.R2_ENDPOINT ||
      (process.env.CLOUDFLARE_ACCOUNT_ID
        ? `https://${process.env.CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`
        : undefined);
    this._s3 = new S3Client({
      region: "auto",
      endpoint,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
      },
    });
    return this._s3;
  }
  async _get(key) {
    const { GetObjectCommand } = await import("@aws-sdk/client-s3");
    const s3 = await this._s3client();
    const obj = await s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    return obj.Body.transformToString();
  }
  async readFile(path) {
    return this._get("files/" + String(path).replace(/^[/\\]+/, ""));
  }
  async listDir(path = ".") {
    const tree = JSON.parse(await this._get("tree.json"));
    const key = normalize(String(path || ".")).replace(/^[/\\]+/, "") || ".";
    return tree[key] || [];
  }
  async grep(pattern, { glob, max = 50 } = {}) {
    // 行索引存在 Turso 的 code_lines 表（ingest 时构建），用 LIKE 子串匹配。
    const { default: db } = await import("../db.mjs");
    const args = ["%" + pattern + "%"];
    let sql = "SELECT path, line, text FROM code_lines WHERE text LIKE ?";
    if (glob) { sql += " AND path GLOB ?"; args.push(glob); }
    sql += " LIMIT ?"; args.push(max);
    const res = await db.execute({ sql, args });
    return res.rows.map((r) => ({ path: r.path, line: Number(r.line), text: r.text }));
  }
}

export function createFsProvider() {
  if (process.env.R2_BUCKET && process.env.R2_ACCESS_KEY_ID) {
    return new R2Provider();
  }
  return new LocalFsProvider();
}
