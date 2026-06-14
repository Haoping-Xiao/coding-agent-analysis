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

  /* 各家招牌设计 */
  vendors: {
    codex: {
      name: "Codex",
      who: "OpenAI · Rust 核心 + 多前端",
      tag: "把「控制」和「输出」拆成两条队列",
      summary: "Rust 写的核心引擎，外面套一层类型化 JSON-RPC 的 app-server，TUI / VS Code / SDK 都是它的客户端。",
      tricks: [
        ["SQ / EQ 双队列", "所有用户意图（消息、打断、审批答复、改设置）排进一条 Submission 队列；所有进展从另一条 Event 队列流出。UI 可以「发了就不管」，审批只是队列里的又一个 Op，顺序天然确定。"],
        ["app-server 类型化门面", "对外的方法（turn/start、item/started…）由 Rust 类型生成，外部集成方拿到稳定、带版本的契约，却不必 fork agent 逻辑。一套核心驱动所有前端。"],
        ["先沙箱、失败再升级", "工具编排器：先审批 → 进沙箱执行 → 若是沙箱（而非用户）挡住了，用已有授权脱沙箱重试。默认安全，又不会因双重弹窗烦死人。"],
        ["一个二进制，多重人格", "同一个可执行文件靠 argv[0] 把自己再调用成沙箱助手 / apply-patch 等。子进程不用单独安装，策略由同一份签名二进制强制执行。"]
      ],
      evidence: "<code>codex-rs/core/src/session/</code> · <code>codex-rs/app-server/</code> · <code>tools/orchestrator.rs</code> · <code>arg0/src/lib.rs</code>"
    },
    claude: {
      name: "Claude Code",
      who: "Anthropic · TypeScript",
      tag: "把 prompt cache 当作架构，而非小优化",
      summary: "一个 while(true) 的 query 循环，但在「省 token、保速度、稳错误」上做到极致。",
      tricks: [
        ["压缩阶梯", "上下文吃紧时按代价从低到高处理：先压缩超大工具输出，再裁剪/折叠，最后才动用摘要 autocompact。让最近的文件内容活得更久，模型少犯错。"],
        ["缓存友好是设计红线", "工具清单顺序固定、旧工具结果用占位符冻结、子 agent 复用父级前缀、改 UI 前先 clone——全是为了命中 prompt cache。长会话因此又快又便宜。"],
        ["边流边执行 + 安全并行", "只读工具在模型还在吐字时就能开跑，写操作串行；但结果仍按调用顺序回灌。Grep/Read 密集的一轮快很多。"],
        ["先扣下错误再恢复", "prompt 太长、输出超限等错误先不抛给上层，先尝试折叠/压缩/截断重试；流式中坏掉的 thinking 块打上墓碑。客户端不会因一个可恢复的溢出就崩掉会话。"]
      ],
      evidence: "<code>restored-src/src/query.ts</code> · <code>services/compact/*</code> · <code>services/tools/StreamingToolExecutor.ts</code>"
    },
    gemini: {
      name: "Gemini CLI",
      who: "Google · TypeScript monorepo",
      tag: "事件总线解耦 + 给历史「兜底修复」",
      summary: "core 引擎与 Ink/React 界面彻底分离；同一套核心还能跑 SDK、A2A server、VS Code 插件。",
      tricks: [
        ["Scheduler + MessageBus", "核心用事件驱动的调度器执行工具与审批，完全不认识前端。终端、SDK、IDE 订阅同一条总线。这是「agent 循环」与「展示层」分离的典范。"],
        ["四层记忆 + 按需加载", "不是一个大 system prompt：仓库级 GEMINI.md、私有 MEMORY.md、全局配置，再加上「工具碰到某目录才注入该子目录规则」的 JIT 上下文。既精简又相关。"],
        ["hardenHistory 兜底", "长会话被截断/压缩后，对话结构可能不再合法（角色不交替、tool 调用没配对）。它用哨兵文本修复这些不变量，避免下一次 API 调用直接 400。"],
        ["改文件前打 git checkpoint", "可恢复的工具调用前，先快照 git 状态并序列化历史，支持 /restore 式回滚。把文件系统状态和对话状态绑在一起。"]
      ],
      evidence: "<code>packages/core/src/scheduler/</code> · <code>confirmation-bus/message-bus.ts</code> · <code>utils/historyHardening.ts</code> · <code>utils/checkpointUtils.ts</code>"
    },
    opencode: {
      name: "OpenCode",
      who: "开源 · TypeScript / Bun",
      tag: "无头 server + 一堆瘦客户端",
      summary: "核心是一个常驻 HTTP server，TUI / 网页 / 桌面 / Slack / IDE 都只是订阅 SSE、调 REST 的客户端。",
      tricks: [
        ["无头 server + 生成式 SDK", "一个长驻服务，所有界面都是客户端。TUI 被明令禁止 import 后端模块，只能走 SDK——倒逼 API 完整。同一套 agent 运行时服务终端、浏览器、IDE 协议与自动化。"],
        ["按请求切项目实例", "服务器启动时不绑定任何项目；每个请求用 x-opencode-directory 头选工作区。于是一个 server 能同时服务多个仓库（远程 attach、局域网 mDNS）。"],
        ["schema 优先的 LLM 层", "单一的 LLMRequest / LLMEvent 流跨 OpenAI / Anthropic / Gemini / Bedrock…provider 的怪癖塞进适配器。换模型是改配置，不是重写逻辑。"],
        ["模式即权限 profile", "build 与 plan 的差别仅在合并后的权限规则集（plan 禁止 edit，除计划文件）。一套工具、一个循环，切模式只是换策略。"]
      ],
      evidence: "<code>packages/opencode/src/server/</code> · <code>cli/cmd/serve.ts</code> · <code>packages/llm/</code> · <code>agent/agent.ts</code>"
    },
    kimi: {
      name: "Kimi Code",
      who: "Moonshot · TypeScript monorepo",
      tag: "引擎与产品分两层 + 全程可 replay",
      summary: "Moonshot 自研（非 Gemini CLI fork），由旧的 kimi-cli 演进。kosong 管模型、loop 管循环、agent-core 管会话与策略。",
      tricks: [
        ["双层循环：engine vs product", "runTurn 只懂「调模型、可能跑工具、重复」；审批、压缩、steer、目标这些 Kimi 特性全挂在 TurnFlow 的 hook 上。核心循环可单独测试与替换。"],
        ["流式与持久转录分离", "token 增量实时推 UI，但只有「完整块」才被记录用于下一次模型调用。UI 快，上下文稳且可重放，半截内容不污染缓存。"],
        ["智能并行工具", "独立工具（读两个文件）并发；声明了重叠文件/shell 访问的工具自动串行。提速又不会在同一路径上打架。"],
        ["wire log + 确定性恢复", "几乎所有状态变更都追加成 AgentRecord；恢复会话就是 replay 这些记录，而非各种特判。既崩溃安全，又能驱动 apps/vis 调试器。"]
      ],
      evidence: "<code>packages/agent-core/src/loop/</code> · <code>agent/turn/index.ts</code> · <code>packages/kosong/</code> · <code>agent/records/index.ts</code>"
    }
  },

  /* 横向对比表：每行一个维度，列对应 codex/claude/gemini/opencode/kimi */
  compare: [
    ["实现语言", "Rust 核心 + 多前端", "TypeScript", "TypeScript monorepo", "TypeScript / Bun", "TypeScript monorepo"],
    ["核心循环", "SQ/EQ 队列 + submission_loop", "while(true) query 循环", "Turn.run 逐块解析", "session processor 流式", "runTurn → step（引擎/产品分层）"],
    ["多端架构", "JSON-RPC app-server", "CLI 为主 + SDK", "事件总线，核心/UI 解耦", "无头 HTTP server + 多客户端", "进程内 RPC（预留 daemon）"],
    ["权限审批", "AskForApproval + 审批缓存", "规则 + 模式 + bash 分类器", "策略引擎 + MessageBus 确认", "allow/deny/ask + shell 词法", "PermissionManager 策略链"],
    ["上下文压缩", "rollout 持久化", "压缩阶梯 + 缓存友好", "hardenHistory 修复 + 压缩", "DB 持久 + 运行器", "微压缩 + 缓存感知"],
    ["招牌绝活", "先沙箱失败再脱沙箱重试", "prompt cache 当架构", "git checkpoint 回滚", "按请求切项目实例", "wire log 确定性恢复"],
    ["沙箱/隔离", "Seatbelt/bwrap/RestrictedToken", "bash 沙箱 + 路径约束", "可选 sandbox 启动", "权限边界 + external_dir", "KAOS 执行抽象（本地/SSH）"]
  ]
};
