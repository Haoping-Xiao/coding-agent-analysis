/* 站点内容数据。所有结论基于 vendors/ 下真实源码。 */
window.SITE_DATA = {
  /* 核心循环每一步的详情 */
  loop: [
    {
      t: "1 · 接收输入",
      d: "一切从一条消息开始：用户的需求，或上一轮工具执行的结果。agent 把它追加到对话历史（messages）里。",
      code: 'messages.push({ role: "user", content: task })',
      note: "Codex 把这一步建模成进入「提交队列」的一个 Op::UserInput。"
    },
    {
      t: "2 · 模型思考（流式）",
      d: "把对话历史 + 可用工具清单一起发给大模型。返回通常是流式的：先吐思考/文本，再吐出工具调用。",
      code: 'const reply = await llm.chat({ messages, tools })',
      note: "Gemini CLI 的 Turn.run 逐块解析流，产出 Content / ToolCallRequest 等事件。"
    },
    {
      t: "3 · 要求调用工具",
      d: "模型不会自己碰电脑，它只是「开口要求」：我要 read 这个文件 / run 这条命令。框架负责真正执行。",
      code: 'reply.toolCalls // [{ name: "read", args: {...} }]',
      note: "判断是否结束，看的是「这一轮还有没有 tool_call」，而不是只看 stop_reason。"
    },
    {
      t: "4 · 审批 + 执行",
      d: "危险操作（写文件、跑命令）先问用户或查规则；通过后在沙箱里执行。这是 agent 不闯祸的关键。",
      code: 'if (needsApproval(call)) await askUser(call)',
      note: "Codex：先审批 → 进沙箱 → 失败再决定是否脱沙箱重试；审批结果按会话缓存，避免反复打扰。"
    },
    {
      t: "5 · 观察 → 回到第 1 步",
      d: "把工具输出包成 tool_result 再喂回模型，开始新一轮。直到某一轮模型不再要求任何工具，循环结束。",
      code: 'messages.push(toolResult(call, output)) // loop',
      note: "上下文越来越长，于是出现了「压缩」——这正是各家拉开差距的地方。"
    }
  ],

  /* 五大部件 */
  anatomy: {
    tools: {
      title: "工具系统：模型的双手",
      lead: "工具就是一组带「名字 + 参数schema + 执行函数」的能力。模型按名字点单，框架做菜。",
      points: [
        ["几乎人手一套的内置工具", "read / write / edit / bash / grep / glob / web 搜索抓取——五家高度雷同，因为编程任务的「原子动作」就这些。"],
        ["统一的定义方式", "都用 schema 描述参数（Zod / JSON Schema / Effect Schema），这样模型才知道怎么填参数，框架也能在执行前校验。"],
        ["可扩展：MCP + 插件", "除了内置工具，五家都支持通过 MCP 协议接入外部工具，做到「不改源码也能加能力」。"]
      ],
      evidence: "Claude Code <code>tools.ts</code> 的 getAllBaseTools · Gemini CLI <code>tool-registry.ts</code> · OpenCode <code>tool/registry.ts</code>"
    },
    perm: {
      title: "权限审批：不闯祸的刹车",
      lead: "能改文件、能跑命令，就必须有刹车。核心是三态决策：allow / deny / ask（问用户）。",
      points: [
        ["规则 + 模式", "权限来自配置/会话/命令行的规则表；还有「模式」概念：计划模式只读、acceptEdits 自动批改、bypass 全放行。"],
        ["读操作放行、写操作设防", "只读工具往往直接 allow；写文件、跑 shell 才触发 ask。OpenCode 甚至把 shell 命令按「词数」归类，让你批准看得懂的命令而非整条原始串。"],
        ["审批可缓存", "同一会话里批准过的同类操作不再反复问你（Codex 的 ApprovalStore），体验和安全的平衡。"]
      ],
      evidence: "Codex <code>AskForApproval</code> 枚举 + orchestrator · Claude Code <code>useCanUseTool</code> · OpenCode <code>permission/arity.ts</code>"
    },
    ctx: {
      title: "上下文管理：和遗忘赛跑",
      lead: "对话越长，token 越多，迟早撑爆模型窗口。怎么「忘得聪明」是高级 agent 的分水岭。",
      points: [
        ["压缩阶梯", "不是一上来就花钱做总结。Claude Code 先裁剪超大工具输出（microcompact），不够再 snip/collapse，最后才 autocompact 做摘要。"],
        ["prompt cache 是一等公民", "工具清单顺序固定、用占位符冻结旧工具结果、子 agent 复用父级前缀——都是为了命中缓存，让长会话更快更省。"],
        ["流式 vs 持久分离", "Kimi Code 把「给 UI 看的 token 流」和「喂回模型的完整块」分开记录，半截内容不会污染下一次请求。"]
      ],
      evidence: "Claude Code <code>services/compact/*</code> + <code>claude.ts</code> getCacheControl · Kimi Code <code>loop/events.ts</code>"
    },
    proto: {
      title: "会话与协议：一个大脑，多个前端",
      lead: "TUI、网页、IDE 插件都想用同一个 agent。于是核心和界面要解耦，靠协议通信。",
      points: [
        ["核心引擎与界面解耦", "Gemini CLI 用事件驱动的 Scheduler + MessageBus，核心跑工具/审批时完全不知道前端是 React 还是别的。"],
        ["类型化协议", "Codex 用 JSON-RPC 的 app-server，方法和事件从 Rust 类型生成 TS/JSON Schema；OpenCode 用 Effect HttpApi → OpenAPI → 自动生成 SDK。"],
        ["双向通信", "审批不是单向的：服务端可以主动向客户端发「请批准这条命令」的请求，客户端答复后再继续。"]
      ],
      evidence: "Codex <code>app-server</code> + <code>app-server-protocol</code> · Gemini CLI <code>message-bus.ts</code> · OpenCode <code>server/api.ts</code>"
    },
    sub: {
      title: "子 Agent：把大任务拆给分身",
      lead: "复杂任务一个上下文装不下，于是主 agent 派生「子 agent」去并行探索，再汇总。",
      points: [
        ["子 agent 复用同一套循环", "Claude Code 的子 agent 就是再调用一次 query()，只是换了独立上下文和权限模式。"],
        ["模式即权限画像", "explore 只读、plan 不许改文件、build 全权限——很多家把「模式」直接做成权限规则集，而不是另写一套 agent。"],
        ["缓存友好的分身", "Claude Code 的 fork 子 agent 让子级继承与父级字节一致的消息前缀，复用 prompt cache。"]
      ],
      evidence: "Claude Code <code>AgentTool/runAgent.ts</code> · OpenCode <code>agent/agent.ts</code> · Kimi Code <code>collaboration/agent.ts</code>"
    }
  },

  /* 各家招牌设计（每家一个主标签；MCP / compaction / steer / 事件总线等共性能力不单列） */
  vendors: {
    codex: {
      name: "Codex",
      who: "OpenAI · Rust 核心 + 多前端",
      tag: "编排与执行拆平面",
      summary: "App Server 对外是 JSON-RPC 的 Thread/Turn/Item；真正跑 shell/PTY/MCP stdio 走独立 exec-server，不是 CLI 里直接 spawn。",
      tricks: [
        ["App Server 一等公民", "turn/start、item/started、turn/steer 由 Rust 类型生成 TS/JSON Schema。VS Code、SDK、TUI 都是客户端；过载时 -32001 背压。"],
        ["exec-server 执行平面", "编排层不直接 spawn：本地 JSON-RPC exec-server 管 PTY；远程用 Noise relay 桥接虚拟 JSON-RPC 流；MCP stdio 也走这条链。"],
        ["arg0 单二进制多角色", "同一可执行文件靠 argv[0] 再调自己为 sandbox、apply_patch、fs helper，并注入 PATH symlink。策略由签名二进制强制执行。"],
        ["声明式沙箱 + execpolicy", "permissions profile 路由到 Seatbelt/bwrap/Windows token；命令级还有 Starlark prefix_rule 的 allow/prompt/forbidden 引擎。"]
      ],
      evidence: "<code>codex-rs/app-server/</code> · <code>codex-rs/exec-server/</code> · <code>codex-rs/arg0/src/lib.rs</code> · <code>codex-rs/execpolicy/</code>"
    },
    claude: {
      name: "Claude Code",
      who: "Anthropic · TypeScript",
      tag: "Hooks 控制面 + Swarm 文件邮箱",
      summary: "query 循环之上叠了可编程 Hooks；多 teammate 用文件系统 inbox 做 IPC，不是简单再 spawn 一个子进程。",
      tricks: [
        ["Hooks exit-code 语义", "25+ 生命周期点；exit 0 放行、2 阻断并喂给模型、其他只展示。同框架挂 shell、HTTP（含 SSRF guard）、嵌套 LLM、异步长任务。"],
        ["Swarm 文件邮箱 IPC", "teammateMailbox 在 ~/.claude/teams/.../inboxes/ 用 lockfile 写 JSON；permissionSync 把 worker 权限请求路由回 leader UI。"],
        ["MCP defer_loading", "MCP/shouldDefer 工具标 defer_loading，由 ToolSearchTool 按需发现；可按 context window 百分比自动开启，避免工具定义撑爆上下文。"],
        ["cache-aware fork", "子 agent 克隆 readFileState 保持与 parent 前缀一致以复用 prompt cache，同时 no-op setAppState、收紧权限提示。"]
      ],
      evidence: "<code>restored-src/src/utils/hooksConfigManager.ts</code> · <code>teammateMailbox.ts</code> · <code>toolSearch.ts</code> · <code>forkedAgent.ts</code>"
    },
    gemini: {
      name: "Gemini CLI",
      who: "Google · TypeScript monorepo",
      tag: "五级 TOML Policy Engine",
      summary: "allow/deny/ask 不是事后弹窗：在 scheduler Validating 阶段由分层规则引擎裁决，再进入执行。",
      tricks: [
        ["五级 tier 优先级", "Admin > User > Workspace > Extension > Default；extension 启动时可 addRule/addChecker 注入策略与 checker。"],
        ["stableStringify 防绕过", "tool args 做确定性序列化（排序 key、处理 circular ref）再匹配 argsPattern 正则，避免参数形态绕过。"],
        ["shell heuristics 联动", "PolicyEngine 结合 SandboxManager 的危险/安全命令启发式，在规则之上动态升降级决策。"],
        ["shadow git checkpoint（辅）", "可恢复工具调用前在隔离 shadow repo 快照 commitHash + clientHistory，/restore 同时回滚文件与对话状态。"]
      ],
      evidence: "<code>packages/core/src/policy/policy-engine.ts</code> · <code>policy/stable-stringify.ts</code> · <code>scheduler/scheduler.ts</code> · <code>services/gitService.ts</code>"
    },
    opencode: {
      name: "OpenCode",
      who: "开源 · TypeScript / Bun",
      tag: "Location 作用域 + inbox promote",
      summary: "runner/catalog/LSP 按工作目录缓存整套 Effect layer；用户输入先进 durable inbox，再 steer/queue promote 成可见消息。",
      tricks: [
        ["Location 缓存整套运行时", "每个 Location.Ref 独立 layer 树：Catalog、ToolRegistry、SessionRunner、BuiltInTools、LSP。同 server 多项目并行。"],
        ["session_input 准入队列", "输入 durable 入库后才投影为 user message；steer 在 provider turn 安全边界抢占，queue 等 turn 结束 FIFO 处理。"],
        ["Context Epoch 版本化", "AGENTS.md、skill 等特权 system context 独立 reconcile 与 lazy replace；compaction 完成后替换 epoch snapshot。"],
        ["write 后 LSP diagnostic 回灌", "write/edit/apply_patch 后 touchFile → diagnostics 注入 tool output，模型可据 LSP 错误自我修正。"]
      ],
      evidence: "<code>packages/core/src/location-layer.ts</code> · <code>session/input.ts</code> · <code>specs/v2/session.md</code> · <code>packages/opencode/src/tool/write.ts</code>"
    },
    kimi: {
      name: "Kimi Code",
      who: "Moonshot · TypeScript monorepo",
      tag: "双层 compaction（Full + Micro）",
      summary: "Full 走 LLM 摘要；Micro 在 prompt cache miss 后只清空旧 tool body，不调模型。",
      tricks: [
        ["Micro 清 tool body", "cache miss 超 1h 且上下文占用 >50% 时，旧 tool 结果替换为 [Old tool result content cleared]，保留近期消息不动。"],
        ["canSplitAfter 保护并行 tool", "compaction 切分点检查 open tool exchange 与 parallel tool results，避免摘要后留下孤儿 tool_result。"],
        ["think-only 当失败模式", "kosong 检测只有 thinking 无 text/tool_calls → APIEmptyResponseError；Full compaction 像截断溢出一样 shrink prefix 重试。"],
        ["资源冲突感知并行", "ToolScheduler + ToolAccesses：声明文件/shell 访问路径重叠则串行，无冲突则并发，不盲目全开也不全串行。"]
      ],
      evidence: "<code>packages/agent-core/src/agent/compaction/micro.ts</code> · <code>compaction/strategy.ts</code> · <code>packages/kosong/src/generate.ts</code> · <code>loop/tool-scheduler.ts</code>"
    }
  },

  /* 横向对比表：每行一个维度，列对应 codex/claude/gemini/opencode/kimi */
  compare: [
    ["实现语言", "Rust 核心 + 多前端", "TypeScript", "TypeScript monorepo", "TypeScript / Bun", "TypeScript monorepo"],
    ["核心循环", "SQ/EQ 队列 + submission_loop", "while(true) query 循环", "Turn.run 逐块解析", "session processor 流式", "runTurn → step（引擎/产品分层）"],
    ["多端架构", "JSON-RPC app-server", "CLI 为主 + SDK", "事件总线，核心/UI 解耦", "无头 HTTP server + 多客户端", "进程内 RPC（预留 daemon）"],
    ["权限审批", "AskForApproval + 审批缓存", "规则 + 模式 + bash 分类器", "策略引擎 + MessageBus 确认", "allow/deny/ask + shell 词法", "PermissionManager 策略链"],
    ["上下文压缩", "rollout 持久化", "压缩阶梯 + 缓存友好", "hardenHistory 修复 + 压缩", "DB 持久 + 运行器", "微压缩 + 缓存感知"],
    ["招牌绝活", "编排/执行拆平面", "Hooks + 文件邮箱 Swarm", "五级 TOML Policy", "Location + Context Epoch", "Micro compaction"],
    ["沙箱/隔离", "Seatbelt/bwrap/RestrictedToken", "bash 沙箱 + 路径约束", "可选 sandbox 启动", "权限边界 + external_dir", "KAOS 执行抽象（本地/SSH）"]
  ]
};
