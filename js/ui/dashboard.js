import { fmtDate, pct, esc, daysUntil } from "../utils.js";
import { recommendedOrder } from "../priorities.js";
import { generateSchedule } from "../schedule.js";
import { doneIds } from "../storage.js";
import { openTask } from "./taskdetail.js";

export function render(state, root) {
  const { courses, tasks, todos } = state.data || { courses: [], tasks: [], todos: [] };
  if (!courses.length) {
    root.innerHTML = `<div class="card"><h2>No active classes</h2><p class="muted">Connect to Canvas to see your classes, or make sure your current semester has published courses.</p></div>`;
    return;
  }

  const merged = [...tasks, ...todos.filter((t) => !state.data.tasks.some((x) => x.id === t.id))];
  const done = new Set(doneIds());
  const open = merged.filter((t) => !t.submitted && !done.has(t.id));
  const focus = recommendedOrder(open, courses).slice(0, 5);

  const dd = new Map(open.map((t) => [t.id, daysUntil(t.dueAt)]));
  const dueToday = open.filter((t) => dd.get(t.id) === 0);
  const dueWeek = open.filter((t) => { const d = dd.get(t.id); return d >= 0 && d <= 7; });
  const openByCourse = new Map();
  for (const t of open) openByCourse.set(t.courseId, (openByCourse.get(t.courseId) || 0) + 1);
  const graded = courses.filter((c) => c.currentScore != null);
  const avgGrade = graded.length ? graded.reduce((a, c) => a + c.currentScore, 0) / graded.length : null;

const courseCards = courses.map((c) => {
    const spread = c.currentScore != null ? pct(c.currentScore) : "—";
    const delta = c.currentScore != null ? Math.round((c.currentScore - c.targetGrade) * 10) / 10 : null;
    const deltaCls = delta == null ? "" : delta >= 0 ? "grade-high" : "grade-low";
    const fill = c.currentScore != null ? Math.max(0, Math.min(100, c.currentScore)) : 0;
    const nOpen = openByCourse.get(c.id) || 0;
    return `
      <div class="card course-card" data-course-id="${c.id}" style="cursor:pointer">
        <div class="top">
          <div>
            <h3>${esc(c.name)}</h3>
            ${c.code ? `<div class="code">${esc(c.code)}</div>` : ""}
          </div>
          ${c.currentGrade ? `<span class="grade-pill grade-${c.currentScore >= c.targetGrade ? "high" : "low"}">${esc(c.currentGrade)}</span>` : ""}
        </div>
        <div class="stat-row">
          <span class="stat">Score <b>${spread}</b></span>
          <span class="stat">Target <b>${c.targetGrade}%</b> <span class="muted small">(${c.type})</span></span>
          ${delta != null ? `<span class="stat"><b class="${deltaCls}">${delta >= 0 ? "+" : ""}${delta}</b> vs target</span>` : ""}
          <span class="stat">Open <b>${nOpen}</b></span>
        </div>
        <div class="progress"><div class="progress-fill" style="width:${fill}%"></div></div>
      </div>`;
  }).join("");

  const focusRows = focus.map(({ task, score, band, reasons }) => `
    <div class="slot">
      <div class="what">
        <div><b>${esc(task.title)}</b> <span class="tag ${band === "high" ? "tag-red" : band === "mid" ? "tag-yellow" : "tag-green"}">${band}</span></div>
        <div class="small muted">${esc(task.courseName)} · ${fmtDate(task.dueAt)}</div>
      </div>
      <div class="priority-bar"><div class="priority-fill ${band === "high" ? "p-high" : band === "mid" ? "p-mid" : "p-low"}" style="width:${score}%"></div></div>
      <span class="muted small" style="max-width:170px">${reasons.map(esc).join(" · ")}</span>
    </div>`).join("") || `<p class="muted">Nothing open right now. Nice.</p>`;

  const sched = generateSchedule(courses, open);
  const todayPlan = sched.days[0];
  const todayRows = todayPlan.slots.map((s) => `
    <div class="slot${s.taskId ? " clickable" : ""} ${s.kind === "break" ? "break" : s.kind === "study" ? "study" : "work"}"${s.taskId ? ` data-task="${esc(s.taskId)}" role="button" tabindex="0" title="Open assignment"` : ""}>
      <span class="time">${s.start}${s.end ? "–" + s.end : ""}</span>
      <div class="what"><div>${esc(s.what)}</div><div class="small muted">${esc(s.labels)}</div></div>
      <span class="mins">${s.mins}m</span>
    </div>`).join("") || `<p class="muted">No study time scheduled. Adjust Settings → Study Time.</p>`;

  const week = Array.from({ length: 7 }, () => []);
  const start = new Date(); start.setHours(0, 0, 0, 0);
  for (const t of open) {
    if (!t.dueAt) continue;
    const dued = new Date(t.dueAt); dued.setHours(0, 0, 0, 0);
    const diff = Math.round((dued - start) / 86400000);
    if (diff >= 0 && diff < 7) week[diff].push(t);
  }
  const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const weekCards = week.map((items, i) => {
    const d = new Date(start); d.setDate(start.getDate() + i);
    const isToday = i === 0;
    const chips = items
      .sort((a, b) => (a.dueAt || "").localeCompare(b.dueAt || "") || (a.title || "").localeCompare(b.title || ""))
      .map((t) => `
        <button class="wk-chip ${t.type}" data-task="${esc(t.id)}" title="${esc(t.courseName)} · open assignment">
          <span class="wk-title">${esc(t.title)}</span>
          <span class="wk-meta">${t.type === "exam" ? "Test" : t.type === "quiz" ? "Quiz" : t.type === "project" ? "Project" : ""}${t.pointsPossible ? ` · ${t.pointsPossible} pts` : ""}</span>
        </button>`).join("");
    return `
      <div class="day-col ${isToday ? "today" : ""}">
        <div class="day-head">
          <span class="day-name">${isToday ? "Today" : DAY_NAMES[d.getDay()]}</span>
          <span class="day-date">${d.getMonth() + 1}/${d.getDate()}</span>
        </div>
        <div class="day-items">${chips || `<span class="day-empty">Free</span>`}</div>
      </div>`;
  }).join("");
  const weekCount = week.reduce((a, d) => a + d.length, 0);

  root.innerHTML = `
    <h1>Dashboard</h1>
    <p class="subtitle">${esc(state.profile?.name || "")} ${avgGrade != null ? `· avg grade <b>${avgGrade.toFixed(1)}%</b> across ${graded.length} graded class${graded.length === 1 ? "" : "es"}` : ""}</p>

    <div class="grid grid-3 mt">
      <div class="card"><div class="small muted">Due today</div><div class="stat"><b>${dueToday.length}</b></div></div>
      <div class="card"><div class="small muted">Due this week</div><div class="stat"><b>${dueWeek.length}</b></div></div>
      <div class="card"><div class="small muted">Classes</div><div class="stat"><b>${courses.length}</b></div></div>
    </div>

    <h2 class="mt">This week on Canvas</h2>
    <p class="small muted">${weekCount ? `${weekCount} open assignment${weekCount === 1 ? "" : "s"} due over the next 7 days — click any chip to open it.` : "Nothing due in the next 7 days."}</p>
    <div class="week-cal mt">${weekCards}</div>

    <h2 class="mt">Classes & grades</h2>
    <div class="grid grid-3" id="courseGrid">${courseCards}</div>

    <h2 class="mt">Do these first</h2>
    <div class="card">${focusRows}</div>

    <h2 class="mt">Tonight</h2>
    <div class="card day-card">${todayRows}</div>
  `;

  root.querySelectorAll(".course-card").forEach((card) => {
    card.addEventListener("click", () => {
      const courseId = +card.dataset.courseId;
      const event = new CustomEvent("tab-change", { detail: { tab: "courseDetail", courseId } });
      window.dispatchEvent(event);
    });
  });

  root.addEventListener("click", (e) => {
    const el = e.target.closest("[data-task]");
    if (!el) return;
    const t = merged.find((x) => x.id === el.dataset.task);
    if (t) openTask(t, state);
  });
  root.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const el = e.target.closest && e.target.closest("[data-task]");
    if (!el) return;
    e.preventDefault();
    const t = merged.find((x) => x.id === el.dataset.task);
    if (t) openTask(t, state);
  });
}