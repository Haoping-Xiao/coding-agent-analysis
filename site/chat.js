(function () {
  "use strict";
  // 后端地址：默认同源（Vercel functions 或本地 server）。可用 window.AGENT_API 覆盖。
  var API = (window.AGENT_API || "").replace(/\/$/, "");
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  function esc(t) {
    return String(t == null ? "" : t)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  var state = { online: false, hasApiKey: false, busy: false };

  /* ---------- 后端探测 ---------- */
  var dot = $("#chatStatusDot");
  var statusText = $("#chatStatusText");
  function setStatus(online, hasApiKey) {
    state.online = online; state.hasApiKey = hasApiKey;
    dot.className = "chat__dot " + (online ? (hasApiKey ? "is-live" : "is-demo") : "is-off");
    statusText.textContent = online
      ? (hasApiKey ? "已连接 · Cursor SDK" : "已连接 · 演示模式（未配 key）")
      : "后端离线 · 仅可浏览 FAQ";
  }
  function probe() {
    if (typeof fetch !== "function") { setStatus(false, false); return Promise.resolve(); }
    return fetch(API + "/api/health")
      .then(function (r) { return r.ok ? r.json() : Promise.reject(); })
      .then(function (j) { setStatus(true, !!j.hasApiKey); })
      .catch(function () { setStatus(false, false); });
  }

  /* ---------- 面板开关 ---------- */
  var panel = $("#chatPanel"), fab = $("#chatFab");
  function openChat() { panel.hidden = false; fab.style.display = "none"; requestAnimationFrame(function () { panel.classList.add("is-open"); }); $("#chatText").focus(); }
  function closeChat() { panel.classList.remove("is-open"); setTimeout(function () { panel.hidden = true; fab.style.display = ""; }, 220); }
  fab.addEventListener("click", openChat);
  $("#chatClose").addEventListener("click", closeChat);

  /* ---------- 消息渲染 ---------- */
  var body = $("#chatBody");
  function addMsg(role, html) {
    var el = document.createElement("div");
    el.className = "msg msg--" + role;
    el.innerHTML = html;
    body.appendChild(el);
    body.scrollTop = body.scrollHeight;
    return el;
  }
  var TYPING = '<span class="msg__typing"><i></i><i></i><i></i></span>';

  // 回答完成后渲染正文 + 「采纳进 FAQ」按钮
  function renderFinal(el, question, answer, model) {
    el.innerHTML = "";
    var p = document.createElement("div");
    p.className = "msg__text";
    p.textContent = answer;
    el.appendChild(p);
    var actions = document.createElement("div");
    actions.className = "msg__actions";
    var adopt = document.createElement("button");
    adopt.className = "msg__adopt";
    adopt.textContent = "👍 采纳并加入 FAQ";
    adopt.addEventListener("click", function () {
      adopt.disabled = true; adopt.textContent = "提交中…";
      fetch(API + "/api/faq", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: question, answer: answer, model: model }),
      }).then(function (r) { return r.json(); }).then(function (j) {
        if (j.ok) { adopt.textContent = "✓ 已加入 FAQ"; loadFaq(); }
        else { adopt.disabled = false; adopt.textContent = "提交失败，重试"; }
      }).catch(function () { adopt.disabled = false; adopt.textContent = "提交失败，重试"; });
    });
    actions.appendChild(adopt);
    el.appendChild(actions);
    body.scrollTop = body.scrollHeight;
  }

  /* ---------- 提问 ---------- */
  function ask(question) {
    if (state.busy) return;
    question = String(question || "").trim();
    if (!question) return;
    var hint = $(".chat__hint"); if (hint) hint.remove();
    addMsg("user", esc(question));
    if (!state.online) {
      addMsg("ai", '<span class="msg__warn">后端未连接，暂时无法提问。你仍可以浏览下方「常见问答」。</span>');
      return;
    }
    state.busy = true;
    var aiEl = addMsg("ai", TYPING);

    fetch(API + "/api/ask", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: question }),
    }).then(function (resp) {
      if (!resp.ok) return resp.json().catch(function () { return {}; }).then(function (j) { throw new Error(j.error || ("请求失败 " + resp.status)); });
      var ct = resp.headers.get("content-type") || "";
      if (ct.indexOf("text/event-stream") >= 0) return streamSSE(resp, aiEl, question);
      return resp.json().then(function (data) {
        if (data && data.mode === "async" && data.agentId && data.runId) return pollRun(aiEl, question, data.agentId, data.runId);
        if (data && data.answer) { renderFinal(aiEl, question, data.answer, data.model || ""); state.busy = false; return; }
        throw new Error((data && data.error) || "未知响应");
      });
    }).catch(function (err) {
      state.busy = false;
      aiEl.innerHTML = '<span class="msg__warn">出错了：' + esc(err.message) + "</span>";
    });
  }

  // 本地 server 的 SSE 流式
  function streamSSE(resp, aiEl, question) {
    if (!resp.body) { state.busy = false; aiEl.innerHTML = '<span class="msg__warn">流式不可用</span>'; return; }
    var reader = resp.body.getReader();
    var decoder = new TextDecoder();
    var buf = "", answer = "", model = "";
    function pump() {
      return reader.read().then(function (res) {
        if (res.done) { state.busy = false; if (answer && !aiEl.querySelector(".msg__actions")) renderFinal(aiEl, question, answer, model); return; }
        buf += decoder.decode(res.value, { stream: true });
        var parts = buf.split("\n\n"); buf = parts.pop();
        parts.forEach(function (block) {
          var ev = (block.match(/^event: (.*)$/m) || [])[1];
          var dl = (block.match(/^data: (.*)$/m) || [])[1];
          if (!ev || !dl) return;
          var data; try { data = JSON.parse(dl); } catch (e) { return; }
          if (ev === "delta") { if (answer === "") aiEl.innerHTML = ""; answer += data.text; aiEl.textContent = answer; body.scrollTop = body.scrollHeight; }
          else if (ev === "final") { answer = data.answer || answer; model = data.model || ""; renderFinal(aiEl, question, answer, model); }
          else if (ev === "error") { aiEl.innerHTML = '<span class="msg__warn">出错了：' + esc(data.message) + "</span>"; }
        });
        return pump();
      });
    }
    return pump();
  }

  // Vercel cloud：轮询 /api/run 直到完成，并实时展示 agent 正在做什么（思考 / 工具调用）。
  function pollRun(aiEl, question, agentId, runId) {
    var t0 = Date.now();
    var lastSteps = [];
    function iconFor(k) { return k === "tool" ? "🔧" : "💭"; }
    function render() {
      var sec = Math.round((Date.now() - t0) / 1000);
      var head = '<div class="run__head">' + TYPING + '<span class="run__elapsed">正在云端阅读源码并思考…（' + sec + 's）</span></div>';
      var feed = "";
      if (lastSteps.length) {
        feed = '<ul class="run__feed">' + lastSteps.map(function (s, i) {
          var live = i === lastSteps.length - 1 ? " is-live" : "";
          return '<li class="run__step' + live + '">' + iconFor(s.k) + " " + esc(s.t) + "</li>";
        }).join("") + "</ul>";
      }
      aiEl.innerHTML = head + feed;
      body.scrollTop = body.scrollHeight;
    }
    render();
    var timer = setInterval(render, 1000);
    var elapsed = 0;
    function poll() {
      fetch(API + "/api/run?agentId=" + encodeURIComponent(agentId) + "&runId=" + encodeURIComponent(runId))
        .then(function (r) { return r.json(); })
        .then(function (d) {
          if (d.status === "finished") { clearInterval(timer); state.busy = false; renderFinal(aiEl, question, d.answer || "", d.model || ""); return; }
          if (d.status === "error" || d.status === "cancelled") { clearInterval(timer); state.busy = false; aiEl.innerHTML = '<span class="msg__warn">运行' + (d.status === "error" ? "出错" : "被取消") + "了，请重试。</span>"; return; }
          if (d.steps && d.steps.length) { lastSteps = d.steps; render(); }
          elapsed += 1;
          if (elapsed > 200) { clearInterval(timer); state.busy = false; aiEl.innerHTML = '<span class="msg__warn">等待超时，请重试。</span>'; return; }
          setTimeout(poll, 1800);
        })
        .catch(function () { elapsed += 1; if (elapsed > 200) { clearInterval(timer); state.busy = false; } else setTimeout(poll, 2000); });
    }
    setTimeout(poll, 1500);
  }

  /* ---------- 表单 / 建议 ---------- */
  var form = $("#chatForm"), text = $("#chatText");
  form.addEventListener("submit", function (e) { e.preventDefault(); ask(text.value); text.value = ""; autoGrow(); });
  text.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); form.requestSubmit ? form.requestSubmit() : ask(text.value); }
  });
  function autoGrow() { text.style.height = "auto"; text.style.height = Math.min(text.scrollHeight, 120) + "px"; }
  text.addEventListener("input", autoGrow);
  $$("#chatSuggest button").forEach(function (b) {
    b.addEventListener("click", function () { openChat(); ask(b.textContent); });
  });

  /* ---------- FAQ 列表 ---------- */
  var faqList = $("#faqList");
  function renderFaq(items) {
    if (!items || !items.length) { faqList.innerHTML = '<p class="faq-empty">还没有问答。右下角问一个，采纳后就会出现在这里。</p>'; return; }
    faqList.innerHTML = items.map(function (it, i) {
      return (
        '<details class="faq-item"' + (i === 0 ? " open" : "") + ">" +
          "<summary>" + esc(it.question) + (it.upvotes ? '<span class="faq-up">👍 ' + it.upvotes + "</span>" : "") + "</summary>" +
          '<div class="faq-ans">' + esc(it.answer) + "</div>" +
          (it.model ? '<div class="faq-meta">来源模型：' + esc(it.model) + "</div>" : "") +
        "</details>"
      );
    }).join("");
  }
  function loadFaq() {
    var fromApi = state.online
      ? fetch(API + "/api/faq").then(function (r) { return r.json(); }).then(function (j) { return j.items; })
      : Promise.reject();
    fromApi.catch(function () {
      return fetch("faq.json").then(function (r) { return r.json(); }).then(function (j) { return j.items; });
    }).then(renderFaq).catch(function () { faqList.innerHTML = '<p class="faq-empty">问答加载失败。</p>'; });
  }

  /* ---------- 启动 ---------- */
  probe().then(loadFaq);
})();
