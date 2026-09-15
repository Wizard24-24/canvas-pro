import { esc, toast } from "../utils.js";
import { settings, doneIds, setDone } from "../storage.js";

function snapshot(state) {
  const courses = state.data?.courses || [];
  const tasks = state.data?.tasks || [];
  const done = new Set(doneIds());
  const open = tasks
    .filter((t) => !t.submitted && !done.has(t.id) && t.canvasId)
    .sort((a, b) => +new Date(a.dueAt || 0) - +new Date(b.dueAt || 0))
    .slice(0, 12);
  const overdue = open.filter((t) => t.dueAt && Date.now() > +new Date(t.dueAt)).length;
  return [
    "You are connected to my Canvas via the Canvas Pro study app. Help me with schoolwork.",
    `Courses (${courses.length}):`,
    ...courses.map((c) => `- ${c.name}: ${c.currentScore != null ? c.currentScore + "%" : "no grade yet"}${c.targetGrade && c.currentScore != null && c.currentScore < c.targetGrade ? " (below target " + c.targetGrade + ")" : ""}`),
    `Open unsubmitted tasks (${open.length}, ${overdue} overdue):`,
    ...open.map((t) => `- ${t.title} (${t.courseName || ""}) ${t.pointsPossible || "?"}pts due ${t.dueAt || "?"}${t.needsGrading ? " PENDING GRADING" : ""}`),
    "Keep answers concise and practical.",
  ].join("\n");
}

export function render(state, root, isStale = () => false) {
  const s = settings();
  if (!state.ai) state.ai = { messages: [], ocSession: null, ctxOn: true };
  const { messages, ocSession, ctxOn } = state.ai;

  root.innerHTML = `
    <h1>AI Assistant</h1>
    <p class="subtitle">Chat with a model that already knows your courses, grades, and open work. Configure the provider in <b>Settings → AI</b> first.</p>

    ${(!s.aiKey && s.aiProvider !== "opencode") ? `<div class="card mt"><b>🔑 No AI key set yet.</b> Go to <b>Settings → AI</b> and pick a provider + key (or choose <b>opencode</b> to use your local opencode — no key needed).</div>` : ""}

    <div class="card chat-card mt">
      <div class="chat-wrap" id="chatWrap" aria-live="polite"></div>
      <div class="ai-input-row">
        <textarea id="aiIn" rows="2" placeholder="Ask about your coursework, e.g. “what should I do first today?”" style="flex:1;padding:11px 13px;border-radius:11px;border:1px solid var(--border);background:var(--bg-soft);color:var(--text);font-size:13px;resize:none"></textarea>
        <button id="aiSend" class="btn btn-primary" style="align-self:flex-end">Send</button>
      </div>
      <div class="ai-tools">
        <label class="check"><input type="checkbox" id="aiCtx" checked /> <span>Include my Canvas snapshot</span></label>
        <button id="aiClear" class="btn btn-ghost btn-small">Clear chat</button>
        <span class="small muted" style="margin-left:auto">provider: ${esc(s.aiProvider)}${s.aiModel ? " · " + esc(s.aiModel) : ""}</span>
      </div>
    </div>
  `;

  const wrap = root.querySelector("#chatWrap");
  const inp = root.querySelector("#aiIn");
  const btn = root.querySelector("#aiSend");
  const ctx = root.querySelector("#aiCtx");
  ctx.addEventListener("change", () => { state.ai.ctxOn = ctx.checked; });
  root.querySelector("#aiClear").addEventListener("click", () => {
    state.ai.ocSession = null; state.ai.messages.length = 0; wrap.innerHTML = "";
  });

  // Restore chat history from persisted state
  for (const m of state.ai.messages) {
    const div = document.createElement("div");
    div.className = "msg " + (m.role === "assistant" ? "bot" : "user");
    div.textContent = m.content;
    wrap.appendChild(div);
  }
  wrap.scrollTop = wrap.scrollHeight;

  inp.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
  });
  btn.addEventListener("click", send);

  function addMsg(role, text) {
    const div = document.createElement("div");
    div.className = "msg " + role;
    div.textContent = text;
    wrap.appendChild(div);
    wrap.scrollTop = wrap.scrollHeight;
    state.ai.messages.push({ role: role === "bot" ? "assistant" : "user", content: text });
    return div;
  }

  // Apply actions the local agent asks for: mark done, or show an SVG chart.
  function applyActions(actions) {
    for (const a of actions || []) {
      if (!a || typeof a !== "object") continue;
      if (a.type === "setDone" && a.id) {
        setDone(a.id, !!a.done);
        if (!isStale()) {
          const div = document.createElement("div");
          div.className = "msg bot tool-note";
          div.textContent = `☑ ${a.title || "Assignment"} marked ${a.done ? "done" : "open"} in the app.`;
          wrap.appendChild(div);
          wrap.scrollTop = wrap.scrollHeight;
        }
      } else if (a.type === "chart" && a.svg) {
        const div = document.createElement("div");
        div.className = "msg bot chart-msg";
        const label = a.title ? `<div class="chart-title">${esc(a.title)}</div>` : "";
        div.innerHTML = `${label}<img src="data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(a.svg)))}" alt="${esc(a.title || "chart")}" />`;
        wrap.appendChild(div);
        wrap.scrollTop = wrap.scrollHeight;
      }
    }
  }

  function renderBubbles(out) {
    if (isStale()) return;
    applyActions(out.actions);
    addMsg("bot", out.text || "(no text from agent)");
  }

  async function send() {
    const text = inp.value.trim();
    if (!text) return;
    inp.value = "";
    addMsg("user", text);
    const s2 = settings();
    const prov = (s2.aiProvider || "openai");
    try {
      if (prov === "local") {
        // Local Ollama agent behind the server: message + done checklist in,
        // text + client actions out.
        const headers = {
          "Content-Type": "application/json",
          "X-AI-Token": s2.token || "",
          "X-AI-Base": s2.canvasBaseUrl || "",
          "X-AI-Ollama": s2.aiUrl || "http://localhost:11434",
          "X-AI-Model": s2.aiModel || "auto",
          "X-AI-Session": state.ai.ocSession || "",
        };
        const resp = await fetch("/api/agent", {
          method: "POST",
          headers,
          body: JSON.stringify({ message: text, doneIds: doneIds() }),
        });
        const sid = resp.headers.get("X-AI-Session");
        if (sid) state.ai.ocSession = sid;
        const rawText = await resp.text();
        let data = {};
        try { data = JSON.parse(rawText); } catch (e) {}
        if (!resp.ok) {
          let why = data.message || "";
          if (!why) why = "Can't reach the local agent. Is Ollama running, and has the server been restarted?";
          throw new Error(why);
        }
        renderBubbles(data);
        return;
      }
      if (prov !== "opencode" && !s2.aiKey) throw new Error("No AI key configured — add one in Settings → AI.");
      const body = { model: s2.aiModel || undefined };
      if (prov === "opencode") {
        const withCtx = state.ai.ctxOn ? `[My Canvas context]\n${snapshot(state)}\n\n---\n${text}` : text;
        body.messages = [{ role: "user", content: withCtx }];
      } else {
        const messagesWithCtx = state.ai.messages.map((m) => ({ ...m }));
        if (state.ai.ctxOn) messagesWithCtx.splice(0, 0, { role: "system", content: snapshot(state) });
        body.messages = messagesWithCtx;
      }
      const headers = {
        "Content-Type": "application/json",
        "X-AI-Provider": prov,
        "X-AI-Url": s2.aiUrl || (prov === "opencode" ? "http://localhost:4096" : "https://api.openai.com/v1/chat/completions"),
      };
      if (s2.aiKey) headers["X-AI-Key"] = s2.aiKey;
      if (prov === "opencode") headers["X-AI-Session"] = state.ai.ocSession || "";
      const resp = await fetch("/api/ai", {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });
      const sid = resp.headers.get("X-AI-Session");
      if (sid) state.ai.ocSession = sid;
      const rawText = await resp.text();
      let data = {};
      try { data = JSON.parse(rawText); } catch (e) {}
      if (!resp.ok) {
        let why = data.error?.message || data.message || (data.error && (data.error.code || data.error.status)) || "";
        if (!why && rawText.trim().startsWith("<")) {
          const m = /<p>(.*?)<\/p>/.exec(rawText);
          why = m ? m[1].replace(/<[^>]*>/g, "") : rawText.slice(0, 200);
        }
        if (prov === "opencode" && !why) why = "Local opencode server refused. Is `opencode serve` running? (Start it in a terminal: `opencode serve`)";
        throw new Error(why || ("HTTP " + resp.status));
      }
      const content = data.choices?.[0]?.message?.content;
      if (!content) throw new Error("No reply content in response");
      if (isStale()) return;
      addMsg("bot", content);
    } catch (err) {
      const nf = (err instanceof TypeError && /failed to fetch/i.test(err.message)) || /networkerror/i.test(err.message || "");
      const msg = nf
        ? prov === "opencode"
          ? "⚠️ Couldn't reach `opencode serve` (is it running? Start it in a terminal: `opencode serve`)."
          : "⚠️ Couldn't reach the local server (\"Failed to fetch\"). This is not an API-key problem — make sure the server has been restarted with the latest code: stop it with Ctrl+C, then run `npm start` again, and reload this page."
        : "⚠️ " + (err.message || String(err));
      if (!isStale()) addMsg("bot", msg);
      if (nf && prov !== "opencode") toast("No response from local server — restart it (Ctrl+C, then npm start).", "err");
    }
  }
}