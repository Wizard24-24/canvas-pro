import { $, $$, toast, esc } from "./utils.js";
import * as canvas from "./canvas.js";
import { settings, saveSettings, cacheData, saveData, emailAllowed, applyTheme } from "./storage.js";
import * as data from "./data.js";

window.__booted = true;

window.addEventListener("error", (e) => {
  toast("Error: " + e.message, "err");
});
window.addEventListener("unhandledrejection", (e) => {
  toast("Error: " + (e.reason?.message || e.reason || "unknown"), "err");
});

import { render as renderDashboard } from "./ui/dashboard.js";
import { render as renderAssignments } from "./ui/assignments.js";
import { render as renderTests } from "./ui/tests.js";
import { render as renderTodo } from "./ui/todo.js";
import { render as renderGrades } from "./ui/grades.js";
import { render as renderStudy } from "./ui/study.js";
import { render as renderCurve } from "./ui/curveview.js";
import { render as renderSettings } from "./ui/settings.js";
import { render as renderDocuments } from "./ui/documents.js";
import { render as renderAnnouncements } from "./ui/announcements.js";
import { render as renderLate } from "./ui/latelist.js";
import { render as renderAi } from "./ui/ai.js";
import { render as renderCourseDetail } from "./ui/courseDetail.js";

const VIEWS = {
  dashboard: renderDashboard,
  assignments: renderAssignments,
  tests: renderTests,
  todo: renderTodo,
  grades: renderGrades,
  study: renderStudy,
  curve: renderCurve,
  settings: renderSettings,
  documents: renderDocuments,
  announcements: renderAnnouncements,
  latelist: renderLate,
  ai: renderAi,
  courseDetail: renderCourseDetail,
};

const state = { data: cacheData(), profile: null };
let lastConnectError = "";

function setBadge() {
  fetch("version.json").then((r) => r.json()).then((v) => {
    const badge = $("#versionBadge");
    if (v.channel === "main") { badge.className = "badge badge-main"; badge.textContent = `v${v.version} STABLE`; }
    else { badge.className = "badge badge-beta"; badge.textContent = `v${v.version} BETA`; }
  }).catch(() => {});
}

function setLoading(on, text) {
  $("#globalLoading").classList.toggle("hidden", !on);
  if (text) $("#loadingText").textContent = text;
  $("#userBtn").disabled = on;
}

function setSync(msg, kind = "") {
  const el = $("#syncState");
  el.className = "sync-state" + (kind ? " " + kind : "");
  el.innerHTML = `<span class="dot"></span>${esc(msg)}`;
}

function showApp() {
  $("#app").classList.remove("hidden");
  $("#onboarding").classList.add("hidden");
  setSync("Ready", "ok");
  const name = state.profile?.name || "—";
  const email = state.profile?.email || "";
  $("#userBtn").textContent = email ? `${name} · ${email}` : name;
}

// Stale-render guard: every tab switch bumps the token; async views that still
// hold the old token know their DOM writes would land on the previous tab.
let renderToken = 0;

async function renderTab(tab) {
  const root = $("#mainContent");
  const token = ++renderToken;
  try {
    root.classList.remove("tab-anim");
    void root.offsetWidth;
    root.classList.add("tab-anim");
    setLoading(true, "Rendering…");
    const fn = VIEWS[tab] || renderDashboard;
    await fn(state, root, () => token !== renderToken);
  } catch (e) {
    if (token !== renderToken) return;
    root.innerHTML = `<div class="card"><h2>Something broke</h2><p class="error">${esc(e.message)}</p><p class="hint error">at: ${esc(e.stack || "").split("\n").slice(0, 3).join(" ⮑ ")}</p></div>`;
    console.error(e);
  } finally {
    if (token === renderToken) setLoading(false);
  }
}

async function connectAndLoad({ silent = false } = {}) {
  const s = settings();
  if (!s.canvasBaseUrl || !s.token) {
    lastConnectError = "Canvas URL and token are required.";
    if (!silent) { toast(lastConnectError, "err"); }
    return false;
  }

  setLoading(true, "Verifying token…");
  canvas.client(s.canvasBaseUrl, s.token);
  let profile;
  try {
    profile = await canvas.getProfile();
  } catch (e) {
    setLoading(false);
    lastConnectError = e.message;
    if (!silent) toast(e.message, "err");
    return false;
  }

  profile = { ...profile, email: profile.primary_email || profile.email || null };

  const check = emailAllowed(profile);
  if (!check.ok) {
    setLoading(false);
    lastConnectError = check.reason;
    if (!silent) toast(check.reason, "err");
    return false;
  }

  s.profile = profile;
  state.profile = profile;
  saveSettings();

  const ok = await fetchAll();
  if (!ok) lastConnectError = "Connected, but could not load your classes/grades from Canvas.";
  return ok;
}

async function fetchAll() {
  setLoading(true, "Fetching your classes, grades, and assignments from Canvas…");
  try {
    const d = await data.loadAll((stage) => setLoading(true, stage));
    d.profile = state.profile;
    state.data = d;
    saveData(d);
    setSync(`Synced · updated ${new Date(settings().lastSync || Date.now()).toLocaleTimeString()}`, "ok");
    renderTab(state.tab || "dashboard");
    return true;
  } catch (e) {
    setSync("Sync failed", "err");
    toast("Could not load data: " + e.message, "err");
    console.error(e);
    return false;
  } finally {
    setLoading(false);
  }
}

function bindEvents() {
  // Event delegation: works even if a node is replaced or a direct binding
  // was set up under an error, and catches clicks on children.
  document.addEventListener("click", (e) => {
    // Only the sidebar's own tab buttons trigger global navigation. Course
    // detail tabs (`.course-tabs .tab-btn`) manage their own panels.
    const tab = e.target.closest && e.target.closest(".sidebar .tab-btn");
    if (tab) {
      switchTab(tab);
      return;
    }
    if (e.target.closest && e.target.closest("#refreshBtn")) {
      fetchAll().catch(() => setSync("Sync failed", "err"));
      return;
    }
    if (e.target.closest && e.target.closest("#modeToggle")) {
      const s = settings();
      s.mode = s.mode === "light" ? "dark" : "light";
      saveSettings();
      applyTheme();
      return;
    }
    if (e.target.closest && e.target.closest("#userBtn")) {
      switchTab(document.querySelector('.sidebar .tab-btn[data-tab="settings"]'));
    }
  });

  // Handle course detail navigation via custom event (dashboard course cards
  // navigate in, the detail view's back button navigates out).
  window.addEventListener("tab-change", (e) => {
    const { tab, courseId } = e.detail || {};
    if (tab === "courseDetail" && courseId) {
      state.ui = state.ui || {};
      state.ui.courseDetailId = courseId;
      renderTab("courseDetail");
      return;
    }
    if (tab === "dashboard") {
      const ui = state.ui || {};
      delete ui.courseDetailId;
      delete ui.courseDetailTab;
      state.tab = "dashboard";
      const dash = document.querySelector('.sidebar .tab-btn[data-tab="dashboard"]');
      if (dash) {
        $$(".sidebar .tab-btn").forEach((b) => b.classList.remove("active"));
        dash.classList.add("active");
      }
      renderTab("dashboard");
    }
  });
}

function switchTab(btn) {
  if (!btn) return;
  try {
    $$(".sidebar .tab-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    state.tab = btn.dataset.tab;
    renderTab(state.tab);
  } catch (err) {
    toast("Tab failed: " + err.message, "err");
    console.error(err);
  }
}

function bindOnboarding() {
  const btn = $("#onConnect");
  const err = $("#onboardingError");
  const note = $("#serverNote");
  btn.addEventListener("click", async () => {
    const url = $("#onCanvasUrl").value.trim();
    const token = $("#onToken").value.trim();
    if (!url || !token) {
      err.textContent = "Both the Canvas URL and token are required.";
      err.classList.remove("hidden");
      return;
    }
    err.classList.add("hidden");
    btn.disabled = true;
    btn.textContent = "Connecting…";
    const s = settings();
    s.canvasBaseUrl = url;
    s.token = token;
    saveSettings();

    const fail = (msg) => {
      err.textContent = msg;
      err.classList.remove("hidden");
      btn.disabled = false;
      btn.textContent = "Connect to Canvas";
    };

    try {
      if (!(await probeL.serverAlive())) {
        fail("The local server is not responding. Keep the npm start terminal open — it is required as the Canvas proxy. Then hit connect again.");
        return;
      }
      note.textContent = "Server OK ✓ — contacting Canvas…";
      const ok = await connectAndLoad();
      if (!ok) {
        fail(lastConnectError || "Connection failed.");
        return;
      }
      showApp();
      btn.disabled = false;
      btn.textContent = "Connect to Canvas";
    } catch (e) {
      fail((e && e.message) || "Connection failed. Check DevTools console (Cmd+Option+J).");
      console.error(e);
    }
  });
}

const probeL = {
  async serverAlive() {
    try {
      const r = await fetch("/version.json?probe=" + Date.now(), { cache: "no-store" });
      return r.ok;
    } catch {
      return false;
    }
  },
};

async function serverStatusOnBoot() {
  const note = $("#serverNote");
  if (!note) return;
  const alive = await probeL.serverAlive();
  note.textContent = alive
    ? "Local server: detected ✓ (npm start is running)"
    : "Local server: NOT responding ✗ — run  npm start  in ~/canvas-pro and keep it open.";
  note.style.color = alive ? "" : "var(--red)";
}

async function init() {
  setBadge();
  bindEvents();
  applyTheme();
  serverStatusOnBoot();
  bindOnboarding();
  const s = settings();
  const cached = cacheData();

  // Always wire the connect button: a stale token can land on this screen and
  // the button must work there too.
  bindOnboarding();

  if (s.token && s.canvasBaseUrl) {
    state.profile = s.profile;
    canvas.client(s.canvasBaseUrl, s.token);

    if (cached && cached.courses) {
      state.data = cached;
      showApp();
      renderTab("dashboard");
      setSync("Loaded offline · refreshing…", "");
      // Auto-sync in the background: the cached view is instant, then grades /
      // to-dos update when the fresh data lands.
      setTimeout(() => {
        fetchAll().catch((e) => {
          setSync("Sync failed", "err");
          toast("Auto-sync failed: " + (e?.message || e), "err");
        });
      }, 350);
    } else if (!(await connectAndLoad())) {
      // Couldn't reconnect; keep the connect screen visible with the error.
    } else {
      showApp();
    }
  }
}

init();