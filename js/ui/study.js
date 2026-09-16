import { esc } from "../utils.js";
import { generateSchedule, scheduleSummary, courseFactors } from "../schedule.js";
import { settings, saveSettings, doneIds, timeLogs } from "../storage.js";
import { openTask } from "./taskdetail.js";

export function render(state, root) {
  const { courses, tasks, todos } = state.data;
  const done = new Set(doneIds());
  const merged = [...tasks, ...todos.filter((t) => !tasks.some((x) => x.id === t.id))];
  const open = merged.filter((t) => !t.submitted && !done.has(t.id) && t.dueAt);
  const s = settings();
  const factors = courseFactors(merged);
  const logs = timeLogs();

  const sched = generateSchedule(courses, open);
  const sum = scheduleSummary(sched.days);
  const s0 = s.studySlots[0] || { start: "18:00", end: "21:00", label: "Evening" };

  const dayCards = sched.days.map((d) => `
    <div class="card day-card">
      <div class="flex between">
        <h3>${d.label}</h3>
        <span class="small muted">${d.used || 0} / ${d.available} min planned</span>
      </div>
      <div class="used-bar"><div class="used-fill" style="width:${d.available ? Math.round((d.used / d.available) * 100) : 0}%"></div></div>
      ${d.slots.length ? d.slots.map((sl) => {
        const loggedMins = logs[sl.taskId]?.mins;
        const attrs = sl.taskId ? `data-task="${esc(sl.taskId)}" role="button" tabindex="0" title="Open assignment"` : "";
        const cls = "slot clickable" + " " + (sl.kind === "break" ? "break" : sl.kind === "study" ? "study" : "work");
        return `
        <div class="${cls}" ${attrs}>
          <span class="time">${sl.start}${sl.end ? "–" + sl.end : ""}</span>
          <div class="what"><div>${esc(sl.what)}</div><div class="small muted">${esc(sl.labels)}${loggedMins ? ` · spent ${loggedMins}m` : ""}</div></div>
          <span class="mins">${sl.mins}m</span>
        </div>`;
      }).join("") : `<p class="muted small">Free / flex time. Add an exam-adjacent day to trigger test prep.</p>`}
    </div>`).join("");

  const courseDifficulty = courses.map((c) => {
    const f = factors[c.id];
    return `
    <div class="row">
      <span class="small muted" style="flex:1">${esc(c.name)}${f ? `<div class="small">adapted ${f.factor.toFixed(2)}× · ${f.n} ${f.n === 1 ? "log" : "logs"}</div>` : ""}</span>
      <select class="course-diff" data-course="${c.id}" style="padding:6px 10px;border-radius:8px;border:1px solid var(--border);background:var(--bg-soft);color:var(--text)">
        <option value="" ${!s.difficultyOverrides?.[c.id] ? "selected" : ""}>Default</option>
        <option value="0.6" ${s.difficultyOverrides?.[c.id]?.factor === 0.6 ? "selected" : ""}>Light</option>
        <option value="1" ${s.difficultyOverrides?.[c.id]?.factor === 1 ? "selected" : ""}>Normal</option>
        <option value="1.6" ${s.difficultyOverrides?.[c.id]?.factor === 1.6 ? "selected" : ""}>Heavy</option>
        <option value="2.2" ${s.difficultyOverrides?.[c.id]?.factor === 2.2 ? "selected" : ""}>Brutal</option>
      </select>
    </div>`;
  }).join("");

  root.innerHTML = `
    <h1>Study Plan</h1>
    <p class="subtitle">Homework is slotted on the due day when your study window fits before the due time, otherwise the day before. Test prep ramps up over the 3 days before an exam (skipping days with no study time, and the exam day itself if your window is after the exam).</p>

    <div class="grid grid-3 mt">
      <div class="card"><div class="small muted">Planned this week</div><div class="stat"><b>${Math.round(sum.totalMins / 60 * 10) / 10} h</b></div></div>
      <div class="card"><div class="small muted">Test prep sessions</div><div class="stat"><b>${sum.studySessions}</b></div></div>
      <div class="card"><div class="small muted">Daily cap</div><div class="stat"><b>${s.maxStudyMinutesPerDay} min</b></div></div>
    </div>

    <div class="grid grid-2 mt">
      <div>${dayCards}</div>
      <div>
        <div class="card">
          <h2>Tune it</h2>
          <div class="flex between" style="margin-bottom:8px">
            <span class="small muted">Study window</span>
            <span class="flex">
              <input id="winStart" type="time" value="${s0.start}" class="time-input" />
              <span class="muted">–</span>
              <input id="winEnd" type="time" value="${s0.end}" class="time-input" />
            </span>
          </div>
          <label class="row" style="margin-bottom:6px">
            <span class="small muted" style="flex:1">Daily max (min)</span>
            <input id="dailyMax" type="number" min="30" max="600" step="15" value="${s.maxStudyMinutesPerDay}" class="time-input" style="width:90px" />
          </label>
          <label class="row" style="margin-bottom:12px">
            <span class="small muted" style="flex:1">Minutes per point <b id="mppVal">${s.baseMinutesPerPoint}</b></span>
            <input id="mpp" type="range" min="0.3" max="3" step="0.1" value="${s.baseMinutesPerPoint}" style="flex:1;accent-color:var(--accent)" />
          </label>
          <div class="flex" style="gap:10px;margin-bottom:12px">
            <label class="col" style="flex:1">
              <span class="small muted">Break every (min)</span>
              <input id="breakEvery" type="number" min="0" max="120" step="5" value="${s.breakEveryMinutes}" style="width:100%" class="time-input" />
            </label>
            <label class="col" style="flex:1">
              <span class="small muted">Break length (min) · 0 = off</span>
              <input id="breakLen" type="number" min="0" max="60" step="5" value="${s.breakMinutes}" style="width:100%" class="time-input" />
            </label>
          </div>
          <button id="saveStudy" class="btn btn-primary">Save &amp; regenerate</button>
        </div>

        <div class="card mt">
          <h2>Class difficulty</h2>
          <p class="small muted">Tells the plan how long to budget per class. Applies to all the work in that class.</p>
          <div class="allocation mt">${courseDifficulty}</div>
        </div>
      </div>
    </div>
  `;

  root.querySelector("#saveStudy").addEventListener("click", () => {
    const st = settings();
    st.studySlots = [{ start: root.querySelector("#winStart").value, end: root.querySelector("#winEnd").value, label: "Evening" }];
    st.maxStudyMinutesPerDay = +root.querySelector("#dailyMax").value;
    st.baseMinutesPerPoint = +root.querySelector("#mpp").value;
    st.breakEveryMinutes = +root.querySelector("#breakEvery").value;
    st.breakMinutes = +root.querySelector("#breakLen").value;
    saveSettings();
    render(state, root);
  });

  root.querySelector("#mpp").addEventListener("input", (e) => {
    root.querySelector("#mppVal").textContent = e.target.value;
  });

  root.querySelectorAll(".course-diff").forEach((sel) => {
    sel.addEventListener("change", () => {
      const st = settings();
      st.difficultyOverrides = st.difficultyOverrides || {};
      if (sel.value) st.difficultyOverrides[sel.dataset.course] = { factor: +sel.value };
      else delete st.difficultyOverrides[sel.dataset.course];
      saveSettings();
    });
  });

  const openFromSlot = (id) => {
    const t = merged.find((x) => x.id === id);
    if (t) openTask(t, state);
  };
  root.addEventListener("click", (e) => {
    const el = e.target.closest("[data-task]");
    if (el) openFromSlot(el.dataset.task);
  });
  root.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const el = e.target.closest && e.target.closest("[data-task]");
    if (!el) return;
    e.preventDefault();
    openFromSlot(el.dataset.task);
  });
}