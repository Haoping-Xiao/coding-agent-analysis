(function () {
  "use strict";
  var API = (window.AGENT_API || "").replace(/\/$/, "");
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  function esc(t) { return String(t == null ? "" : t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }

  // 轻量 Markdown 渲染（先 esc 防 XSS，再解析常见语法）。无外部依赖。
  function mdInline(s) {
    return s
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, "$1<em>$2</em>")
      .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  }
  // 轻量语法高亮（作用于已转义的代码文本）：注释/字符串/数字/关键字/函数名。覆盖 TS/JS/Rust/bash。
  var HL_RE = /(\/\*[\s\S]*?\*\/|\/\/[^\n]*)|(`[^`]*`|"[^"]*"|'[^']*')|(\b\d+(?:\.\d+)?\b)|(\b(?:const|let|var|function|fn|async|await|return|if|else|for|while|do|switch|case|break|continue|new|class|import|from|export|default|type|interface|enum|struct|impl|trait|pub|mut|match|yield|throw|try|catch|finally|in|of|as|use|true|false|null|None|Some|Ok|Err|undefined|void|self|this)\b)|([A-Za-z_$][\w$]*(?=\s*\())/g;
  function highlightCode(code) {
    return code.replace(HL_RE, function (m, com, str, num, kw, fn) {
      if (com != null) return '<span class="hl-com">' + com + "</span>";
      if (str != null) return '<span class="hl-str">' + str + "</span>";
      if (num != null) return '<span class="hl-num">' + num + "</span>";
      if (kw != null) return '<span class="hl-kw">' + kw + "</span>";
      if (fn != null) return '<span class="hl-fn">' + fn + "</span>";
      return m;
    });
  }
  function mdToHtml(src) {
    var text = esc(src == null ? "" : src);
    var blocks = [];
    text = text.replace(/```[\w-]*\n?([\s\S]*?)```/g, function (_, code) {
      blocks.push('<pre class="md-pre"><code>' + highlightCode(code.replace(/\n$/, "")) + "</code></pre>");
      return "\u0000B" + (blocks.length - 1) + "\u0000";
    });
    var lines = text.split("\n"), out = [], i = 0;
    var isBreak = function (l) { return /^(#{1,6}\s|\s*[-*+]\s|\s*\d+\.\s|\s*>\s|\u0000B)/.test(l) || /^\s*([-*_])\1{2,}\s*$/.test(l) || /^\s*$/.test(l); };
    while (i < lines.length) {
      var line = lines[i];
      var ph = line.match(/^\u0000B(\d+)\u0000$/);
      if (ph) { out.push(blocks[+ph[1]]); i++; continue; }
      if (/^\s*$/.test(line)) { i++; continue; }
      var h = line.match(/^(#{1,6})\s+(.*)$/);
      if (h) { var lvl = Math.min(h[1].length + 3, 6); out.push("<h" + lvl + ' class="md-h">' + mdInline(h[2]) + "</h" + lvl + ">"); i++; continue; }
      if (/^\s*([-*+])\s+/.test(line)) { var ul = []; while (i < lines.length && /^\s*([-*+])\s+/.test(lines[i])) { ul.push("<li>" + mdInline(lines[i].replace(/^\s*([-*+])\s+/, "")) + "</li>"); i++; } out.push('<ul class="md-ul">' + ul.join("") + "</ul>"); continue; }
      if (/^\s*\d+\.\s+/.test(line)) { var ol = []; while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) { ol.push("<li>" + mdInline(lines[i].replace(/^\s*\d+\.\s+/, "")) + "</li>"); i++; } out.push('<ol class="md-ol">' + ol.join("") + "</ol>"); continue; }
      if (/^\s*>\s?/.test(line)) { var bq = []; while (i < lines.length && /^\s*>\s?/.test(lines[i])) { bq.push(mdInline(lines[i].replace(/^\s*>\s?/, ""))); i++; } out.push('<blockquote class="md-bq">' + bq.join("<br>") + "</blockquote>"); continue; }
      if (/^\s*([-*_])\1{2,}\s*$/.test(line)) { out.push('<hr class="md-hr">'); i++; continue; }
      var para = [line]; i++;
      while (i < lines.length && !isBreak(lines[i])) { para.push(lines[i]); i++; }
      out.push("<p>" + para.map(mdInline).join("<br>") + "</p>");
    }
    return out.join("");
  }

  var state = { online: false, hasApiKey: false, busy: false };
  var token = null;
  try { token = localStorage.getItem("admin_token") || null; } catch (e) {}
  function authHeaders() { return token ? { Authorization: "Bearer " + token } : {}; }
  function isAdmin() { return Boolean(token); }

  /* ---------- 探测后端 ---------- */
  var dot = $("#chatStatusDot"), statusText = $("#chatStatusText");
  function setStatus() {
    dot.className = "chat__dot " + (state.online ? (isAdmin() ? "is-live" : "is-demo") : "is-off");
    statusText.textContent = !state.online ? "后端离线 · 仅可浏览 FAQ"
      : (isAdmin() ? "管理员 · 可提问" : "访客 · 只读（管理员可提问）");
  }
  function probe() {
    if (typeof fetch !== "function") { state.online = false; setStatus(); return Promise.resolve(); }
    return fetch(API + "/api/health").then(function (r) { return r.ok ? r.json() : Promise.reject(); })
      .then(function (j) { state.online = true; state.hasApiKey = !!j.hasApiKey; setStatus(); })
      .catch(function () { state.online = false; setStatus(); });
  }

  /* ---------- 面板开关 ---------- */
  var panel = $("#chatPanel"), fab = $("#chatFab"), body = $("#chatBody");
  var HINT_HTML = body.innerHTML; // 管理员模式的默认提示（含建议气泡）
  function openChat() { panel.hidden = false; fab.style.display = "none"; requestAnimationFrame(function () { panel.classList.add("is-open"); }); applyMode(); }
  function closeChat() { panel.classList.remove("is-open"); setTimeout(function () { panel.hidden = true; fab.style.display = ""; }, 220); }
  fab.addEventListener("click", openChat);
  $("#chatClose").addEventListener("click", closeChat);

  /* ---------- 登录门禁 ---------- */
  var form = $("#chatForm"), text = $("#chatText");
  var historyLoaded = false;
  function applyMode() {
    if (isAdmin()) {
      form.style.display = "";
      if (!historyLoaded) {
        historyLoaded = true;
        loadHistory().then(function (has) { if (!has) { body.innerHTML = HINT_HTML; wireSuggest(); } });
      } else if (body.querySelector(".login")) { body.innerHTML = HINT_HTML; wireSuggest(); }
      var t = $("#chatText"); if (t) t.focus();
    } else {
      form.style.display = "none";
      body.innerHTML =
        '<div class="login">' +
          '<p class="login__note">只有<strong>管理员</strong>可以向 AI 提问。普通访客可以浏览整页内容与下方「常见问答」。</p>' +
          '<input id="admUser" class="login__in" placeholder="账号" autocomplete="username" />' +
          '<input id="admPass" class="login__in" type="password" placeholder="密码" autocomplete="current-password" />' +
          '<button id="admLogin" class="login__btn">管理员登录</button>' +
          '<p id="admErr" class="login__err"></p>' +
        "</div>";
      var btn = $("#admLogin");
      function submit() { doLogin($("#admUser").value, $("#admPass").value); }
      btn.addEventListener("click", submit);
      $("#admPass").addEventListener("keydown", function (e) { if (e.key === "Enter") submit(); });
    }
    setStatus();
  }
  function doLogin(u, p) {
    var err = $("#admErr"); if (err) err.textContent = "登录中…";
    fetch(API + "/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: u, password: p }) })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (o) {
        if (o.ok && o.j.token) { token = o.j.token; try { localStorage.setItem("admin_token", token); } catch (e) {} applyMode(); }
        else { if (err) err.textContent = (o.j && o.j.error) || "登录失败"; }
      }).catch(function () { if (err) err.textContent = "网络错误，请重试"; });
  }
  function logout() { token = null; historyLoaded = false; try { localStorage.removeItem("admin_token"); } catch (e) {} applyMode(); }

  // 恢复管理员历史对话（进页面时）。返回 Promise<boolean>：是否渲染了历史。
  function loadHistory() {
    if (!isAdmin() || !state.online) return Promise.resolve(false);
    return fetch(API + "/api/history", { headers: authHeaders() })
      .then(function (r) { return r.ok ? r.json() : Promise.reject(); })
      .then(function (j) {
        var items = (j && j.items) || [];
        body.innerHTML = "";
        if (!items.length) return false;
        items.forEach(function (turn) {
          addMsg("user", esc(turn.question));
          var ai = addMsg("ai", "");
          renderFinal(ai, turn.question, turn.answer, turn.model || "", turn.steps || [], false);
        });
        body.scrollTop = body.scrollHeight;
        return true;
      })
      .catch(function () { return false; });
  }

  /* ---------- 消息 ---------- */
  function addMsg(role, html) { var el = document.createElement("div"); el.className = "msg msg--" + role; el.innerHTML = html; body.appendChild(el); body.scrollTop = body.scrollHeight; return el; }
  var TYPING = '<span class="msg__typing"><i></i><i></i><i></i></span>';

  function renderFinal(el, question, answer, model, proc, save) {
    el.innerHTML = "";
    if (proc && proc.length) {
      var det = document.createElement("details"); det.className = "run__done";
      det.innerHTML = '<summary>运行过程 · ' + proc.length + ' 步</summary><ul class="run__feed">' + proc.map(function (it) { return renderItem(it, true); }).join("") + "</ul>";
      el.appendChild(det);
    }
    var p = document.createElement("div"); p.className = "msg__text md"; p.innerHTML = mdToHtml(answer); el.appendChild(p);
    if (save && isAdmin()) {
      fetch(API + "/api/history", { method: "POST", headers: Object.assign({ "Content-Type": "application/json" }, authHeaders()), body: JSON.stringify({ question: question, answer: answer, model: model, steps: proc || [] }) }).catch(function () {});
    }
    var actions = document.createElement("div"); actions.className = "msg__actions";
    var adopt = document.createElement("button"); adopt.className = "msg__adopt"; adopt.textContent = "👍 采纳并加入 FAQ";
    adopt.addEventListener("click", function () {
      adopt.disabled = true; adopt.textContent = "提交中…";
      fetch(API + "/api/faq", { method: "POST", headers: Object.assign({ "Content-Type": "application/json" }, authHeaders()), body: JSON.stringify({ question: question, answer: answer, model: model }) })
        .then(function (r) { return r.json(); }).then(function (j) {
          if (j.ok) { adopt.textContent = "✓ 已加入 FAQ"; loadFaq(); } else { adopt.disabled = false; adopt.textContent = "提交失败，重试"; }
        }).catch(function () { adopt.disabled = false; adopt.textContent = "提交失败，重试"; });
    });
    actions.appendChild(adopt); el.appendChild(actions); body.scrollTop = body.scrollHeight;
  }

  /* ---------- 提问 ---------- */
  function ask(question) {
    if (state.busy) return;
    question = String(question || "").trim(); if (!question) return;
    if (!isAdmin()) { return; }
    var hint = $(".chat__hint"); if (hint) hint.remove();
    addMsg("user", esc(question));
    if (!state.online) { addMsg("ai", '<span class="msg__warn">后端未连接。</span>'); return; }
    state.busy = true;
    var aiEl = addMsg("ai", TYPING);
    fetch(API + "/api/ask", { method: "POST", headers: Object.assign({ "Content-Type": "application/json" }, authHeaders()), body: JSON.stringify({ question: question }) })
      .then(function (resp) {
        if (resp.status === 401) { state.busy = false; logout(); aiEl.innerHTML = '<span class="msg__warn">登录已失效，请重新登录。</span>'; return; }
        if (!resp.ok) return resp.json().catch(function () { return {}; }).then(function (j) { throw new Error(j.error || ("请求失败 " + resp.status)); });
        return resp.json().then(function (data) {
          if (data && data.mode === "async" && data.agentId && data.runId) return pollRun(aiEl, question, data.agentId, data.runId, !!data.warm);
          if (data && data.answer) { renderFinal(aiEl, question, data.answer, data.model || "", null, true); state.busy = false; return; }
          throw new Error((data && data.error) || "未知响应");
        });
      }).catch(function (err) { state.busy = false; aiEl.innerHTML = '<span class="msg__warn">出错了：' + esc(err.message) + "</span>"; });
  }

  function renderItem(it, doneView) {
    var ico, cls;
    if (it.kind === "tool") {
      if (it.status === "completed") { ico = "✓"; cls = "is-done"; }
      else if (it.status === "error") { ico = "✗"; cls = "is-err"; }
      else { ico = doneView ? "✓" : '<span class="run__spin"></span>'; cls = doneView ? "is-done" : "is-live"; }
    } else if (it.kind === "thinking") { ico = "💭"; cls = "is-think"; }
    else if (it.kind === "answering") { ico = "✎"; cls = doneView ? "is-done" : "is-live"; }
    else { ico = "•"; cls = ""; }
    return '<li class="run__step ' + cls + '"><span class="run__ico">' + ico + '</span><span class="run__txt">' + esc(it.label || it.name || "") + "</span></li>";
  }

  function pollRun(aiEl, question, agentId, runId, warm) {
    var t0 = Date.now(), done = false, since = 0, items = [], toolIdx = {};
    var phase = warm ? "连接已就绪的 agent" : "准备云端沙箱、克隆代码仓";
    // 温 agent（已克隆）只需等它开始读码；冷启动才有「克隆仓库」阶段。
    var PHASES = warm
      ? [{ t: "连接已就绪的 agent", until: 8 }, { t: "在源码里查阅、检索", until: 1e9 }]
      : [{ t: "准备云端沙箱", until: 12 }, { t: "克隆源码仓库（首次较慢）", until: 50 }, { t: "在源码里查阅、检索", until: 95 }, { t: "组织通俗易懂的答案", until: 1e9 }];
    function ingest(events) {
      (events || []).forEach(function (ev) {
        if (ev.id > since) since = ev.id;
        if (ev.kind === "status") { phase = ev.label || phase; }
        else if (ev.kind === "tool") { var k = ev.call_id || ev.name; if (toolIdx[k] != null) { var it = items[toolIdx[k]]; it.status = ev.status; if (ev.label) it.label = ev.label; } else { toolIdx[k] = items.length; items.push({ kind: "tool", call_id: k, name: ev.name, label: ev.label, status: ev.status }); } }
        else if (ev.kind === "thinking") { items.push({ kind: "thinking", label: ev.label }); }
        else if (ev.kind === "answering") { if (!items.some(function (x) { return x.kind === "answering"; })) items.push({ kind: "answering", label: "正在组织答案…" }); }
      });
    }
    function fallbackRows(sec) {
      var cur = PHASES.length - 1; for (var i = 0; i < PHASES.length; i++) { if (sec < PHASES[i].until) { cur = i; break; } }
      return PHASES.map(function (p, i) { var cls = i < cur ? "is-done" : (i === cur ? "is-live" : ""); var ico = i < cur ? "✓" : (i === cur ? '<span class="run__spin"></span>' : "○"); return '<li class="run__step ' + cls + '"><span class="run__ico">' + ico + '</span><span class="run__txt">' + esc(p.t) + "</span></li>"; }).join("");
    }
    function render() {
      var sec = Math.round((Date.now() - t0) / 1000);
      var rows = items.length ? items.map(function (it) { return renderItem(it, false); }).join("") : fallbackRows(sec);
      var headTxt = items.length ? esc(phase) : "正在云端基于源码作答";
      aiEl.innerHTML = '<div class="run__head"><span class="run__spin"></span><span class="run__elapsed">' + headTxt + " · " + sec + "s</span></div><ul class=\"run__feed\">" + rows + "</ul>";
      body.scrollTop = body.scrollHeight;
    }
    render();
    var timer = setInterval(function () { if (!done) render(); }, 1000);
    var elapsed = 0;
    function poll() {
      fetch(API + "/api/run?agentId=" + encodeURIComponent(agentId) + "&runId=" + encodeURIComponent(runId) + "&since=" + since, { headers: authHeaders() })
        .then(function (r) { if (r.status === 401) { throw new Error("登录已失效"); } return r.json(); })
        .then(function (d) {
          ingest(d.events);
          if (d.status === "finished") { done = true; clearInterval(timer); state.busy = false; renderFinal(aiEl, question, d.answer || "", d.model || "", items, true); return; }
          if (d.status === "error" || d.status === "cancelled") { done = true; clearInterval(timer); state.busy = false; aiEl.innerHTML = '<span class="msg__warn">运行' + (d.status === "error" ? "出错" : "被取消") + "了，请重试。</span>"; return; }
          render(); elapsed += 1;
          if (elapsed > 200) { done = true; clearInterval(timer); state.busy = false; aiEl.innerHTML = '<span class="msg__warn">等待超时，请重试。</span>'; return; }
          setTimeout(poll, 1800);
        })
        .catch(function () { elapsed += 1; if (elapsed > 200) { done = true; clearInterval(timer); state.busy = false; } else setTimeout(poll, 2500); });
    }
    setTimeout(poll, 1500);
  }

  /* ---------- 表单 / 建议 ---------- */
  form.addEventListener("submit", function (e) { e.preventDefault(); ask(text.value); text.value = ""; autoGrow(); });
  text.addEventListener("keydown", function (e) { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); form.requestSubmit ? form.requestSubmit() : ask(text.value); } });
  function autoGrow() { text.style.height = "auto"; text.style.height = Math.min(text.scrollHeight, 120) + "px"; }
  text.addEventListener("input", autoGrow);
  function wireSuggest() { $$("#chatSuggest button").forEach(function (b) { b.addEventListener("click", function () { ask(b.textContent); }); }); }
  wireSuggest();

  /* ---------- FAQ ---------- */
  var faqList = $("#faqList");
  // 管理员删除评论：在稳定的 #faqList 容器上做一次性事件委托（不随重渲染失效）。
  faqList.addEventListener("click", function (e) {
    var btn = e.target && e.target.closest ? e.target.closest(".cmt-del") : null;
    if (!btn || !isAdmin()) return;
    var item = btn.closest(".faq-item");
    var listEl = item ? item.querySelector(".cmt-list") : null;
    btn.disabled = true;
    fetch(API + "/api/comments?id=" + encodeURIComponent(btn.getAttribute("data-id")), { method: "DELETE", headers: authHeaders() })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (j && j.ok) {
          var row = btn.closest(".cmt"); if (row) row.remove();
          if (listEl && item) {
            var cc = item.querySelector(".faq-cc"); if (cc) cc.textContent = "💬 " + listEl.querySelectorAll(".cmt").length;
            if (!listEl.querySelector(".cmt")) listEl.innerHTML = '<p class="cmt-empty">还没有评论，来留第一条 👇</p>';
          }
        } else { btn.disabled = false; }
      })
      .catch(function () { btn.disabled = false; });
  });
  function renderFaq(items) {
    if (!items || !items.length) { faqList.innerHTML = '<p class="faq-empty">还没有问答。管理员问一个、采纳后就会出现在这里。</p>'; return; }
    faqList.innerHTML = items.map(function (it, i) {
      return '<details class="faq-item" data-id="' + it.id + '"' + (i === 0 ? " open" : "") + "><summary>" + esc(it.question) +
        '<span class="faq-badges">' + (it.upvotes ? '<span class="faq-up">👍 ' + it.upvotes + "</span>" : "") + '<span class="faq-cc">💬 ' + (it.comment_count || 0) + "</span></span>" +
        "</summary><div class=\"faq-ans md\">" + mdToHtml(it.answer) + "</div>" + (it.model ? '<div class="faq-meta">来源模型：' + esc(it.model) + "</div>" : "") +
        '<div class="faq-comments"><div class="cmt-head">评论（帮助优化这条问答）</div><div class="cmt-list"><p class="cmt-empty">加载中…</p></div>' +
        '<form class="cmt-form"><div class="cmt-row"><input class="cmt-input" placeholder="留个评论 / 建议…" maxlength="2000" /><button type="submit" class="cmt-send">发送</button></div></form>' +
        "</div></details>";
    }).join("");
    wireFaq();
  }
  // 访客随机昵称（生成一次、存本地，保持一致）。管理员评论的昵称由服务端用用户名覆盖。
  function guestName() {
    try { var n = localStorage.getItem("guest_name"); if (n) return n; } catch (e) {}
    var adj = ["好奇", "热心", "钻研", "路过", "认真", "爱学", "求知", "摸鱼"][Math.floor(Math.random() * 8)];
    var noun = ["读者", "开发者", "同学", "访客", "工程师", "调包侠"][Math.floor(Math.random() * 6)];
    var name = adj + "的" + noun + Math.floor(Math.random() * 90 + 10);
    try { localStorage.setItem("guest_name", name); } catch (e) {}
    return name;
  }
  function cmtRow(c) {
    var del = isAdmin() ? '<button class="cmt-del" data-id="' + c.id + '" title="删除评论">✕ 删除</button>' : "";
    return '<div class="cmt" data-id="' + c.id + '"><span class="cmt-author">' + esc(c.author || "匿名") + '</span><span class="cmt-time">' + esc((c.created_at || "").slice(0, 16)) + "</span>" + del + '<div class="cmt-body">' + esc(c.body) + "</div></div>";
  }
  function loadComments(faqId, listEl) {
    fetch(API + "/api/comments?faqId=" + encodeURIComponent(faqId))
      .then(function (r) { return r.json(); })
      .then(function (j) {
        var its = (j && j.items) || [];
        listEl.innerHTML = its.length ? its.map(cmtRow).join("") : '<p class="cmt-empty">还没有评论，来留第一条 👇</p>';
      })
      .catch(function () { listEl.innerHTML = '<p class="cmt-empty">评论加载失败。</p>'; });
  }
  function wireFaq() {
    $$("#faqList .faq-item").forEach(function (d) {
      var id = d.getAttribute("data-id");
      var listEl = d.querySelector(".cmt-list");
      var form = d.querySelector(".cmt-form");
      function maybeLoad() { if (d.open && !d.dataset.cl) { d.dataset.cl = "1"; loadComments(id, listEl); } }
      d.addEventListener("toggle", maybeLoad);
      maybeLoad();
      form.addEventListener("submit", function (e) {
        e.preventDefault();
        var inEl = form.querySelector(".cmt-input"), btn = form.querySelector(".cmt-send");
        var body = inEl.value.trim(); if (!body) return;
        btn.disabled = true;
        fetch(API + "/api/comments", { method: "POST", headers: Object.assign({ "Content-Type": "application/json" }, authHeaders()), body: JSON.stringify({ faqId: id, author: guestName(), body: body }) })
          .then(function (r) { return r.json(); })
          .then(function (j) {
            btn.disabled = false;
            if (j && j.ok) {
              var empty = listEl.querySelector(".cmt-empty"); if (empty) listEl.innerHTML = "";
              listEl.insertAdjacentHTML("beforeend", cmtRow(j.comment));
              inEl.value = "";
              var cc = d.querySelector(".faq-cc"); if (cc) cc.textContent = "💬 " + (listEl.querySelectorAll(".cmt").length);
            }
          })
          .catch(function () { btn.disabled = false; });
      });
    });
  }
  function loadFaq() {
    var fromApi = state.online ? fetch(API + "/api/faq").then(function (r) { return r.json(); }).then(function (j) { return j.items; }) : Promise.reject();
    fromApi.catch(function () { return fetch("faq.json").then(function (r) { return r.json(); }).then(function (j) { return j.items; }); }).then(renderFaq).catch(function () { faqList.innerHTML = '<p class="faq-empty">问答加载失败。</p>'; });
  }

  /* ---------- 启动 ---------- */
  probe().then(loadFaq);
})();
