(function () {
  "use strict";
  var API = (window.AGENT_API || "").replace(/\/$/, "");
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  function esc(t) { return String(t == null ? "" : t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }

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
  function applyMode() {
    if (isAdmin()) {
      form.style.display = "";
      if (body.querySelector(".login")) { body.innerHTML = HINT_HTML; wireSuggest(); }
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
  function logout() { token = null; try { localStorage.removeItem("admin_token"); } catch (e) {} applyMode(); }

  /* ---------- 消息 ---------- */
  function addMsg(role, html) { var el = document.createElement("div"); el.className = "msg msg--" + role; el.innerHTML = html; body.appendChild(el); body.scrollTop = body.scrollHeight; return el; }
  var TYPING = '<span class="msg__typing"><i></i><i></i><i></i></span>';

  function renderFinal(el, question, answer, model, proc) {
    el.innerHTML = "";
    if (proc && proc.length) {
      var det = document.createElement("details"); det.className = "run__done";
      det.innerHTML = '<summary>运行过程 · ' + proc.length + ' 步</summary><ul class="run__feed">' + proc.map(function (it) { return renderItem(it, true); }).join("") + "</ul>";
      el.appendChild(det);
    }
    var p = document.createElement("div"); p.className = "msg__text"; p.textContent = answer; el.appendChild(p);
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
          if (data && data.answer) { renderFinal(aiEl, question, data.answer, data.model || ""); state.busy = false; return; }
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
          if (d.status === "finished") { done = true; clearInterval(timer); state.busy = false; renderFinal(aiEl, question, d.answer || "", d.model || "", items); return; }
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
  function renderFaq(items) {
    if (!items || !items.length) { faqList.innerHTML = '<p class="faq-empty">还没有问答。管理员问一个、采纳后就会出现在这里。</p>'; return; }
    faqList.innerHTML = items.map(function (it, i) {
      return '<details class="faq-item"' + (i === 0 ? " open" : "") + "><summary>" + esc(it.question) + (it.upvotes ? '<span class="faq-up">👍 ' + it.upvotes + "</span>" : "") + '</summary><div class="faq-ans">' + esc(it.answer) + "</div>" + (it.model ? '<div class="faq-meta">来源模型：' + esc(it.model) + "</div>" : "") + "</details>";
    }).join("");
  }
  function loadFaq() {
    var fromApi = state.online ? fetch(API + "/api/faq").then(function (r) { return r.json(); }).then(function (j) { return j.items; }) : Promise.reject();
    fromApi.catch(function () { return fetch("faq.json").then(function (r) { return r.json(); }).then(function (j) { return j.items; }); }).then(renderFaq).catch(function () { faqList.innerHTML = '<p class="faq-empty">问答加载失败。</p>'; });
  }

  /* ---------- 启动 ---------- */
  probe().then(loadFaq);
})();
