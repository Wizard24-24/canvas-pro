export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") node.className = v;
    else if (k === "style") node.style.cssText = v;
    else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
    else if (k === "dataset") Object.assign(node.dataset, v);
    else node.setAttribute(k, v);
  }
  for (const c of children) {
    if (c == null) continue;
    node.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return node;
}

export function num(x, digits = 1) {
  if (x == null || Number.isNaN(+x)) return "—";
  return (+x).toFixed(digits);
}

export function pct(x, digits = 1) {
  if (x == null || Number.isNaN(+x)) return "—";
  return (+x).toFixed(digits) + "%";
}

export function fmtDate(iso) {
  if (!iso) return "No due date";
  const d = new Date(iso);
  const diff = d - new Date();
  const day = d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  if (diff < -86400000) return `${day} · ${time} (past)`;
  return `${day} · ${time}`;
}

export function daysUntil(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  const dueMid = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const now = new Date();
  const todayMid = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return Math.round((dueMid - todayMid) / 86400000);
}

export function minutesUntil(iso) {
  if (!iso) return null;
  return Math.round((new Date(iso) - new Date()) / 60000);
}

export function isOverdue(iso) {
  if (!iso) return false;
  return new Date(iso) < new Date();
}

export function dueTimeOfDay(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  return d.getHours() * 60 + d.getMinutes();
}

export function clamp(v, min, max) { return Math.min(max, Math.max(min, v)); }

export function toast(msg, kind = "") {
  const wrap = $("#toastWrap");
  if (!wrap) return;
  const t = el("div", { class: `toast ${kind}` }, msg);
  wrap.append(t);
  setTimeout(() => t.remove(), 5000);
}

export function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}