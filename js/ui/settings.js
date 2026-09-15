import { esc, toast } from "../utils.js";
import { settings, saveSettings, cloudReady, applyTheme } from "../storage.js";
import { courseTypeFor } from "../data.js";

export function render(state, root) {
  const s = settings();
  const p = state.profile;

  const typeOptions = (cur) => `
    <option value="regular" ${cur === "regular" ? "selected" : ""}>Regular</option>
    <option value="honors" ${cur === "honors" ? "selected" : ""}>Honors</option>
    <option value="ap" ${cur === "ap" ? "selected" : ""}>AP / IB</option>`;

  const courseTypeRows = state.data.courses.map((c) => `
    <div class="row">
      <span class="small" style="flex:1">${esc(c.name)}</span>
      <select class="course-type" data-course="${c.id}" style="padding:6px 10px;border-radius:8px;border:1px solid var(--border);background:var(--bg-soft);color:var(--text)">
        ${typeOptions(courseTypeFor(c))}
      </select>
    </div>`).join("");

  root.innerHTML = `
    <h1>Settings</h1>

    <div class="card">
      <h2>Appearance</h2>
      <p class="small muted">Pick a palette, then a mode — every theme has a dark and a light version. Applies instantly, saved on this device.</p>
      <div class="theme-row mt">
        ${[
          { id: "midnight", name: "Midnight", desc: "Cool blue night", sw: "sw-midnight" },
          { id: "earthy", name: "Earthy", desc: "Warm, natural tones", sw: "sw-earthy" },
          { id: "earthy-green", name: "Earthy Green", desc: "Forest greens, sage", sw: "sw-earthy-green" },
          { id: "cream", name: "Cream", desc: "Soft light cream", sw: "sw-cream" },
        ].map((t) => `
          <button class="theme-swatch ${s.theme === t.id ? "active" : ""}" data-theme="${t.id}">
            <div class="sw ${t.sw}"></div>
            <div class="name">${t.name}</div>
            <div class="desc">${t.desc}</div>
          </button>`).join("")}
      </div>
      <div class="mode-seg mt flex">
        <button id="modeDark" class="btn btn-small ${s.mode !== "light" ? "active" : ""}">Dark</button>
        <button id="modeLight" class="btn btn-small ${s.mode === "light" ? "active" : ""}">Light</button>
        <span class="small muted">You can also toggle mode from the 🌙 / ☀️ button in the top bar.</span>
      </div>
    </div>

    <div class="card mt">
      <h2>Canvas connection</h2>
      ${p ? `<div class="flex between">
        <div><b>${esc(p.name)}</b><div class="small muted">${esc(p.email)} · user #${esc(p.id)}</div></div>
        <button id="reconnect" class="btn btn-small">Change token</button>
      </div>` : `<p class="muted">Not connected.</p>`}
      <div class="field"><span>Canvas base URL</span><input id="setUrl" value="${esc(s.canvasBaseUrl)}" /></div>
      <div class="field"><span>Access token <span class="muted small">(always local, never uploaded)</span></span><input id="setToken" type="password" placeholder="••••••••" autocomplete="off" /></div>
    </div>

    <div class="card mt">
      <h2>AI assistant</h2>
      <p class="small muted">Powered the AI tab. Your key is stored locally and only ever sent to the provider endpoint you choose. GitHub Copilot works best with a GitHub token from an account that has Copilot.</p>
      <div class="field"><span>Provider</span>
        <select id="aiProvider">
          <option value="opencode" ${s.aiProvider === "opencode" ? "selected" : ""}>opencode (local, no key)</option>
          <option value="local" ${s.aiProvider === "local" ? "selected" : ""}>Local Ollama model (on this machine)</option>
          <option value="gemini" ${s.aiProvider === "gemini" ? "selected" : ""}>Google Gemini (API key)</option>
          <option value="openai" ${s.aiProvider === "openai" ? "selected" : ""}>OpenAI-compatible (OpenAI, Azure, Together, LocalAI, Groq…)</option>
          <option value="openrouter" ${s.aiProvider === "openrouter" ? "selected" : ""}>OpenRouter (any model)</option>
          <option value="copilot" ${s.aiProvider === "copilot" ? "selected" : ""}>GitHub Copilot</option>
        </select>
      </div>
      <div class="field"><span>Endpoint URL <span class="muted small">(/v1/chat/completions, Copilot's chat endpoint, or Ollama base URL for “Local Ollama”)</span></span><input id="aiUrl" value="${esc(s.aiUrl)}" placeholder="https://api.openai.com/v1/chat/completions" /></div>
      <div class="grid grid-2">
        <label class="field"><span>Model</span><input id="aiModel" value="${esc(s.aiModel)}" placeholder="gpt-4o" /></label>
        <label class="field"><span>Key / token <span class="muted small">(never leaves your machine)</span></span><input id="aiKey" type="password" value="${esc(s.aiKey)}" autocomplete="off" /></label>
      </div>
      <p class="small muted mt" id="aiHint"></p>
      <div class="flex mt">
        <button id="aiSaveNow" class="btn btn-primary btn-small">Save AI settings</button>
        <button id="aiTest" class="btn btn-small">Test connection</button>
        <span id="aiTestStatus" class="small muted"></span>
      </div>
    </div>

    <div class="card mt">
      <h2>Account access (Canvas email only)</h2>
      <p class="small muted">This app only accepts accounts tied to real Canvas emails. The email is verified from your Canvas profile when you connect.</p>
      <div class="field">
        <span>Allowed email domains <span class="muted small">(comma-separated; e.g. school.edu. Leave empty → blocks common personal mail like gmail.com)</span></span>
        <input id="setDomains" value="${esc(s.allowedDomains?.join(", ") || "")}" placeholder="school.edu, district.k12.us" />
      </div>
      <div class="check-item">
        <div><div>Block personal email domains</div><div class="desc">If no allowlist above, reject gmail/yahoo/etc. accounts automatically.</div></div>
        <label class="toggle"><input type="checkbox" id="setBlockMail" ${s.blockPersonalEmails ? "checked" : ""} /><span class="track"></span></label>
      </div>
    </div>

    <div class="card mt">
      <h2>GPA targets</h2>
      <p class="small muted">Subjects keep a 4.0 when regular = A, honors = B+, AP = B. Grades below these targets make the priority system work harder on that class.</p>
      <div class="grid grid-3 mt">
        <label class="field"><span>Regular (%)</span><input id="tgtRegular" type="number" min="0" max="100" value="${s.targets.regular}" /></label>
        <label class="field"><span>Honors (%)</span><input id="tgtHonors" type="number" min="0" max="100" value="${s.targets.honors}" /></label>
        <label class="field"><span>AP / IB (%)</span><input id="tgtAp" type="number" min="0" max="100" value="${s.targets.ap}" /></label>
      </div>
      <div class="mt"><b class="small muted">Per-class type</b> <span class="small muted">(overrides auto-detection from the course name)</span>
        <div class="allocation mt">${courseTypeRows || `<span class="muted small">Connect to Canvas to set per-class types.</span>`}</div>
      </div>
    </div>

    <div class="card mt">
      <h2>Cloud storage (Supabase)</h2>
      <p class="small muted">Optional. Curve logs sync here so future users can see how classes have curved historically. Your Canvas token is <b>never</b> sent anywhere.</p>
      <div class="field"><span>Supabase URL</span><input id="sbUrl" value="${esc(s.supabase.url || "")}" placeholder="https://xxxx.supabase.co" /></div>
      <div class="field"><span>Anon key</span><input id="sbKey" value="${esc(s.supabase.anonKey || "")}" type="password" autocomplete="off" /></div>
      <div class="flex mt">
        <button id="sbTest" class="btn btn-small">Test connection</button>
        <span id="sbStatus" class="small muted"></span>
      </div>
    </div>

    <div class="card mt">
      <h2>Local data</h2>
      <div class="flex mt">
        <button id="exportData" class="btn btn-small">Export JSON</button>
        <button id="clearData" class="btn btn-small" style="color:var(--red)">Disconnect &amp; clear local data</button>
      </div>
    </div>
  `;

  const save = () => saveSettings();
  const apply = () => { applyTheme(); save(); };

  root.querySelectorAll(".theme-swatch").forEach((b) => {
    b.addEventListener("click", () => {
      const t = b.dataset.theme;
      root.querySelectorAll(".theme-swatch").forEach((x) => x.classList.toggle("active", x === b));
      s.theme = t;
      apply();
      toast(`Palette saved: ${t}.`);
    });
  });

  const setMode = (mode, btn) => {
    s.mode = mode;
    root.querySelector("#modeDark")?.classList.toggle("active", mode !== "light");
    root.querySelector("#modeLight")?.classList.toggle("active", mode === "light");
    apply();
  };
  root.querySelector("#modeDark")?.addEventListener("click", () => setMode("dark"));
  root.querySelector("#modeLight")?.addEventListener("click", () => setMode("light"));

  root.querySelector("#reconnect")?.addEventListener("click", () => {
    localStorage.removeItem("cp:settings");
    localStorage.removeItem("cp:data");
    location.reload();
  });

  root.querySelector("#setUrl")?.addEventListener("change", (e) => { s.canvasBaseUrl = e.target.value.trim(); save(); });
  root.querySelector("#setToken")?.addEventListener("change", (e) => { s.token = e.target.value.trim(); save(); });
  root.querySelector("#setDomains")?.addEventListener("change", (e) => {
    s.allowedDomains = e.target.value.split(",").map((d) => d.trim().toLowerCase()).filter(Boolean); save();
  });
  root.querySelector("#setBlockMail")?.addEventListener("change", (e) => { s.blockPersonalEmails = e.target.checked; save(); });

  const AI_HINTS = {
    opencode: "opencode: no API key needed. Talks to your local `opencode serve` (default http://localhost:4096) and uses the model/tools opencode is configured with. Leave Key blank; model blank = opencode's default.",
    local: "Local Ollama: runs entirely on this machine. Needs the Ollama app running (`ollama serve`). Model is auto-detected from what you've pulled — leave the Model field blank. No key needed. The assistant also gets server-side tools to read your courses/tasks and mark work done.",
    gemini: "Google Gemini: uses Google's OpenAI-compatible endpoint. Get a free API key at Google AI Studio (aistudio.google.com) and paste it below.",
    openai: "OpenAI-compatible: works with OpenAI, Azure OpenAI, Groq, Together, LocalAI… Endpoint points at /v1/chat/completions.",
    openrouter: "OpenRouter: one key, dozens of models (openrouter.ai). 'openrouter/auto' picks the best one for your request automatically.",
    copilot: "GitHub Copilot: uses api.githubcopilot.com. Needs a token from a GitHub account with an active Copilot subscription. Unofficial endpoint; may change.",
  };
  const AI_URLS = {
    opencode: "http://localhost:4096",
    local: "http://localhost:11434",
    gemini: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
    openai: "https://api.openai.com/v1/chat/completions",
    openrouter: "https://openrouter.ai/api/v1/chat/completions",
    copilot: "https://api.githubcopilot.com/chat/completions",
  };
  const AI_MODELS = { opencode: "", local: "auto", gemini: "gemini-3.8-flash", openai: "gpt-4o", openrouter: "openrouter/auto", copilot: "gpt-4o" };
  const KNOWN_DEFAULTS = Object.values(AI_MODELS);
  const setAiHint = () => {
    const sel = root.querySelector("#aiProvider");
    const hint = root.querySelector("#aiHint");
    if (sel && hint) hint.textContent = AI_HINTS[sel.value] || "";
  };
  setAiHint();
  root.querySelector("#aiProvider")?.addEventListener("change", (e) => {
    const pv = e.target.value;
    const url = root.querySelector("#aiUrl");
    const model = root.querySelector("#aiModel");
    if (url && !url.value) url.value = AI_URLS[pv] || "";
    if (model && (!model.value || KNOWN_DEFAULTS.includes(model.value))) model.value = AI_MODELS[pv] || "";
    setAiHint();
  });
  root.querySelector("#aiSaveNow")?.addEventListener("click", () => {
    s.aiProvider = root.querySelector("#aiProvider").value;
    s.aiUrl = root.querySelector("#aiUrl").value.trim();
    s.aiModel = root.querySelector("#aiModel").value.trim();
    s.aiKey = root.querySelector("#aiKey").value.trim();
    save();
    toast("AI settings saved.");
  });

  root.querySelector("#aiTest")?.addEventListener("click", async () => {
    s.aiProvider = root.querySelector("#aiProvider").value;
    s.aiUrl = root.querySelector("#aiUrl").value.trim();
    s.aiModel = root.querySelector("#aiModel").value.trim();
    s.aiKey = root.querySelector("#aiKey").value.trim();
    saveSettings();
    const st = root.querySelector("#aiTestStatus");
    const prov = s.aiProvider || "openai";
    if (!s.aiUrl && prov !== "local" && prov !== "opencode") { st.textContent = "Endpoint URL is empty."; return; }
    st.textContent = "Testing…";
    st.style.color = "var(--muted)";
    try {
      let reply;
      if (prov === "local") {
        const resp = await fetch("/api/agent", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-AI-Token": s.token || "",
            "X-AI-Base": s.canvasBaseUrl || "",
            "X-AI-Ollama": s.aiUrl || AI_URLS.local,
            "X-AI-Model": s.aiModel || AI_MODELS.local,
          },
          body: JSON.stringify({ reset: true, message: "Reply with the single word: OK" }),
        });
        const raw = await resp.text();
        let data = {};
        try { data = JSON.parse(raw); } catch (e) {}
        if (!resp.ok) throw new Error(data.message || ("HTTP " + resp.status));
        reply = data.text;
      } else {
        const resp = await fetch("/api/ai", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-AI-Provider": prov,
            "X-AI-Url": s.aiUrl || AI_URLS[prov] || "https://api.openai.com/v1/chat/completions",
            "X-AI-Key": s.aiKey || "",
          },
          body: JSON.stringify({ model: s.aiModel || undefined, messages: [{ role: "user", content: "Reply with the single word: OK" }] }),
        });
        const raw = await resp.text();
        let data = {};
        try { data = JSON.parse(raw); } catch (e) {}
        if (!resp.ok) {
          let why = data.error?.message || data.message || "";
          if (prov === "opencode" && !why) why = "Is `opencode serve` running? Start it in a terminal.";
          throw new Error(why || ("HTTP " + resp.status));
        }
        reply = data.choices?.[0]?.message?.content;
      }
      st.textContent = reply != null ? `✓ Connected — reply: ${String(reply).slice(0, 60)}` : "✓ Connected";
      st.style.color = "var(--green)";
    } catch (e) {
      st.textContent = `✗ ${(e.message || String(e)).slice(0, 140)}`;
      st.style.color = "var(--red)";
    }
  });

  root.querySelector("#tgtRegular")?.addEventListener("change", (e) => { s.targets.regular = +e.target.value; save(); });
  root.querySelector("#tgtHonors")?.addEventListener("change", (e) => { s.targets.honors = +e.target.value; save(); });
  root.querySelector("#tgtAp")?.addEventListener("change", (e) => { s.targets.ap = +e.target.value; save(); });

  root.querySelectorAll(".course-type").forEach((sel) => {
    sel.addEventListener("change", () => {
      s.courseTypes[sel.dataset.course] = sel.value;
      save();
      toast("Saved.");
    });
  });

  root.querySelector("#sbUrl")?.addEventListener("change", (e) => { s.supabase.url = e.target.value.trim(); save(); });
  root.querySelector("#sbKey")?.addEventListener("change", (e) => { s.supabase.anonKey = e.target.value.trim(); save(); });

  root.querySelector("#sbTest")?.addEventListener("click", async () => {
    const st = root.querySelector("#sbStatus");
    saveSettings();
    if (!cloudReady()) { st.textContent = "Fill URL and anon key first."; return; }
    st.textContent = "Testing…";
    const { cloudFetch } = await import("../storage.js");
    try {
      await cloudFetch("/rest/v1/curve_data?select=count&limit=1");
      st.textContent = "✓ Connected";
    } catch (e) {
      st.textContent = "✗ " + e.message;
    }
  });

  root.querySelector("#exportData")?.addEventListener("click", () => {
    const blob = new Blob([JSON.stringify({ settings: settings(), data: localStorage.getItem("cp:data") || null }, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "canvas-pro-export.json";
    a.click();
    URL.revokeObjectURL(a.href);
  });

  root.querySelector("#clearData")?.addEventListener("click", () => {
    if (!confirm("Disconnect and delete all locally stored data?")) return;
    Object.keys(localStorage).filter((k) => k.startsWith("cp:")).forEach((k) => localStorage.removeItem(k));
    location.reload();
  });
}