import { esc, toast, daysUntil, isOverdue } from "../utils.js";
import { settings, saveSettings, doneIds, setDone, markAllDone, clearDone } from "../storage.js";
import { rowHTML } from "./_rows.js";
import { openTask } from "./taskdetail.js";

function byDue(a, b) {
  return (a.dueAt || "9999")?.localeCompare(b.dueAt || "9999") || (a.title || "").localeCompare(b.title || "");
}

const HEAD = `<thead><tr><th></th><th>Assignment</th><th>Type</th><th>Due</th><th>Status</th></tr></thead>`;

export function render(state, root) {
  const { courses, tasks, todos } = state.data;
  let done = new Set(doneIds());
  const all = [...tasks, ...todos.filter((t) => !tasks.some((x) => x.id === t.id))];
  const isTest = (t) => t.type === "exam" || t.type === "quiz";
  const work = all.filter((t) => !isTest(t));

  root.innerHTML = `
    <h1>Assignments</h1>
    <p class="subtitle">Homework, essays &amp; projects — tests &amp; quizzes live on the <b>Tests</b> tab. Click any title to open it right here.</p>
    <div class="flex mt">
      <input id="asgSearch" class="search" placeholder="Search…" style="padding:9px 13px;border-radius:10px;border:1px solid var(--border);background:var(--bg-soft);color:var(--text);flex:1;max-width:300px" />
      <label class="flex small muted" style="white-space:nowrap">
        <input type="checkbox" id="asgHideDone" ${settings().filterSubmitted ? "checked" : ""} /> Hide submitted
      </label>
      <button id="asgMarkAll" class="btn btn-small">✓ Mark all open done</button>
      ${doneIds().length ? `<button id="asgClearDone" class="btn btn-small btn-ghost">Reset done ✓</button>` : ""}
    </div>
    <div id="asgList" class="mt"></div>
  `;

  const q = root.querySelector("#asgSearch");
  const hide = root.querySelector("#asgHideDone");
  const list = root.querySelector("#asgList");

  function draw() {
    const term = q.value.toLowerCase();

    const passes = (t) => {
      if (term && !(`${t.title} ${t.courseName}`).toLowerCase().includes(term)) return false;
      if (hide.checked && t.submitted) return false;
      return true;
    };
    const isLate = (t) => isOverdue(t.dueAt) && !t.submitted && !done.has(t.id);
    const lateSet = new Set(work.filter(isLate).map((t) => t.id));

    const lateItems = work.filter((t) => lateSet.has(t.id) && passes(t)).sort(byDue);
    const lateHTML = lateItems.length
      ? `<div class="card mt card-late">
          <div class="flex between">
            <h3>⚠️ Late — ${lateItems.length}</h3>
            <span class="small muted">overdue & not submitted</span>
          </div>
          <div class="table-wrap"><table>
            ${HEAD}
            <tbody>${lateItems.map((t) => rowHTML(t, done)).join("")}</tbody>
          </table></div>
        </div>`
      : "";

    let courseHTML = "";
    for (const c of courses) {
      const inCourse = work.filter((t) => t.courseId === c.id && !lateSet.has(t.id)).sort(byDue);
      const active = inCourse.filter((t) => !t.submitted && !done.has(t.id));
      const completed = inCourse.filter((t) => t.submitted || done.has(t.id));
      const activeShown = active.filter(passes);
      const completedShown = completed.filter(passes);
      if (!activeShown.length && !completedShown.length) continue;

      const displayDone = new Set(done);
      for (const t of completed) if (t.submitted) displayDone.add(t.id);

      const doneFold = completedShown.length
        ? `<details class="done-collapse"${term ? " open" : ""}>
            <summary>Completed ✓ · ${completed.length}</summary>
            <div class="table-wrap"><table>
              ${HEAD}
              <tbody>${completedShown.map((t) => rowHTML(t, displayDone)).join("")}</tbody>
            </table></div>
          </details>`
        : "";

      courseHTML += `
        <div class="card mt">
          <div class="flex between">
            <h3>${esc(c.name)}</h3>
            <div class="small muted">${activeShown.length} open · ${completed.length} done</div>
          </div>
          <div class="table-wrap"><table>
            ${HEAD}
            <tbody>${activeShown.map((t) => rowHTML(t, done)).join("")}</tbody>
          </table></div>
          ${doneFold}
        </div>`;
    }

    list.innerHTML = lateHTML + courseHTML || `<p class="muted">No assignments match.</p>`;
  }

  q.addEventListener("input", draw);
  hide.addEventListener("change", () => {
    settings().filterSubmitted = hide.checked;
    saveSettings();
    draw();
  });

  list.addEventListener("change", (e) => {
    const cb = e.target.closest(".done-box");
    if (!cb) return;
    done = new Set(setDone(cb.dataset.id, cb.checked));
    draw();
  });

  list.addEventListener("click", (e) => {
    const open = e.target.closest(".task-open");
    if (open) {
      const task = all.find((t) => t.id === open.dataset.id);
      if (task) openTask(task, state);
      return;
    }
    const clear = e.target.closest("#asgClearDone");
    if (clear) {
      clearDone();
      done = new Set();
      draw();
    }
  });

  root.querySelector("#asgMarkAll").addEventListener("click", () => {
    const openIds = work.filter((t) => !t.submitted && !done.has(t.id)).map((t) => t.id);
    if (openIds.length) {
      done = new Set(markAllDone(openIds));
      toast(`${openIds.length} marked done.`, "ok");
      draw();
    } else {
      toast("Nothing open left to mark.", "");
    }
  });

  draw();
}