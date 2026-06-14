(function () {
  "use strict";
  // 后端地址：默认同源（被 server/ 托管时）。静态部署可在页面里设 window.AGENT_API。
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
    if (!fetchable()) { setStatus(false, false); return Promise.resolve(); }
    return fetch(API + "/api/health", { method: "GET" })
      .then(function (r) { return r.ok ? r.json() : Promise.reject(); })
      .then(function (j) { setStatus(true, !!j.hasApiKey); })
      .catch(function () { setStatus(false, false); });
  }
  function fetchable() { return typeof fetch === "function"; }

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

  /* ---------- 提问 + SSE 流式 ---------- */
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
    var aiEl = addMsg("ai", '<span class="msg__typing"><i></i><i></i><i></i></span>');
    var answer = "";
    var model = "";

    fetch(API + "/api/ask", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: question }),
    }).then(function (resp) {
      if (!resp.ok || !resp.body) throw new Error("请求失败 (" + resp.status + ")");
      var reader = resp.body.getReader();
      var decoder = new TextDecoder();
      var buf = "";
      function pump() {
        return reader.read().then(function (res) {
          if (res.done) { finish(); return; }
          buf += decoder.decode(res.value, { stream: true });
          var parts = buf.split("\n\n");
          buf = parts.pop();
          parts.forEach(handleEvent);
          return pump();
        });
      }
      function handleEvent(block) {
        var ev = (block.match(/^event: (.*)$/m) || [])[1];
        var dataLine = (block.match(/^data: (.*)$/m) || [])[1];
        if (!ev || !dataLine) return;
        var data; try { data = JSON.parse(dataLine); } catch (e) { return; }
        if (ev === "delta") {
          if (answer === "") aiEl.innerHTML = "";
          answer += data.text;
          aiEl.textContent = answer;
          body.scrollTop = body.scrollHeight;
        } else if (ev === "final") {
          answer = data.answer || answer; model = data.model || "";
          renderFinal(aiEl, question, answer, model);
        } else if (ev === "error") {
          aiEl.innerHTML = '<span class="msg__warn">出错了：' + esc(data.message) + "</span>";
        }
      }
      function finish() { state.busy = false; if (answer && !aiEl.querySelector(".msg__actions")) renderFinal(aiEl, question, answer, model); }
      return pump();
    }).catch(function (err) {
      state.busy = false;
      aiEl.innerHTML = '<span class="msg__warn">出错了：' + esc(err.message) + "</span>";
    });
  }

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
        method: "POST",
        headers: { "Content-Type": "application/json" },
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

  /* ---------- FAQ 列表（优先后端，否则读静态 faq.json） ---------- */
  var faqList = $("#faqList");
  function renderFaq(items) {
    if (!items || !items.length) { faqList.innerHTML = '<p class="faq-empty">还没有问答。右下角问一个，采纳后就会出现在这里。</p>'; return; }
    faqList.innerHTML = items.map(function (it, i) {
      return (
        '<details class="faq-item"' + (i === 0 ? " open" : "") + ">" +
          "<summary>" + esc(it.question) +
            (it.upvotes ? '<span class="faq-up">👍 ' + it.upvotes + "</span>" : "") +
          "</summary>" +
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
    }).then(renderFaq).catch(function () {
      faqList.innerHTML = '<p class="faq-empty">问答加载失败。</p>';
    });
  }

  /* ---------- 启动 ---------- */
  probe().then(loadFaq);
})();
