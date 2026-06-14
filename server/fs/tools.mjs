// 把 FsProvider 暴露成 Cursor SDK 的 customTools，让 agent 通过工具访问代码仓，
// 而不依赖 agent 进程所在机器的真实文件系统。
export function buildCustomTools(fs) {
  return {
    read_file: {
      description:
        "读取代码仓里某个文件的全部内容。path 是相对仓库根的路径，例如 vendors/codex/README.md。",
      parameters: {
        type: "object",
        properties: { path: { type: "string", description: "相对仓库根的文件路径" } },
        required: ["path"],
      },
      execute: async ({ path }) => {
        try {
          const content = await fs.readFile(path);
          return content.length > 60000 ? content.slice(0, 60000) + "\n…(已截断)" : content;
        } catch (e) {
          return "读取失败：" + String(e.message || e);
        }
      },
    },
    list_dir: {
      description: "列出代码仓某个目录下的文件与子目录。path 相对仓库根，默认根目录。",
      parameters: {
        type: "object",
        properties: { path: { type: "string", description: "相对仓库根的目录路径，默认 '.'" } },
      },
      execute: async ({ path }) => {
        try {
          return JSON.stringify(await fs.listDir(path || "."));
        } catch (e) {
          return "列目录失败：" + String(e.message || e);
        }
      },
    },
    grep: {
      description:
        "在代码仓里按正则/子串搜索代码，返回命中的 文件路径 + 行号 + 该行文本。可用 glob 限定文件范围。",
      parameters: {
        type: "object",
        properties: {
          pattern: { type: "string", description: "要搜索的正则或子串" },
          glob: { type: "string", description: "可选，文件名 glob，如 *.rs" },
        },
        required: ["pattern"],
      },
      execute: async ({ pattern, glob }) => {
        try {
          const hits = await fs.grep(pattern, { glob, max: 50 });
          return hits.length ? JSON.stringify(hits) : "没有命中。";
        } catch (e) {
          return "搜索失败：" + String(e.message || e);
        }
      },
    },
  };
}
