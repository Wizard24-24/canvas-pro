import { settings, timeLogs, doneIds } from "./storage.js";
import { recommendedOrder } from "./priorities.js";
import { clamp, daysUntil, dueTimeOfDay } from "./utils.js";

const HORIZON = 7;

function difficultyFactor(task) {
  const s = settings();
  const ov = task.difficultyOverride;
  if (ov?.factor) return ov.factor * 0.4 + 0.6;
  return s.difficulty[task.type] ?? 1.4;
}

export function rawEstimate(task) {
  const base = task.baseMinutes || (task.pointsPossible || 0) * settings().baseMinutesPerPoint || 20;
  const factor = difficultyFactor(task);
  let mins = Math.round(base * factor);
  if (task.type === "exam") mins = clamp(mins * 2.5, 30, 300);
  else if (task.type === "quiz") mins = clamp(mins, 15, 90);
  else mins = clamp(mins, 10, 120);
  return mins;
}

function learnedMap(tasks) {
  const logs = timeLogs();
  const map = new Map();
  if (!Object.keys(logs).length) return map;
  const courseOf = new Map(tasks.map((t) => [t.id, t.courseId]));
  for (const [tid, rec] of Object.entries(logs)) {
    const courseId = courseOf.get(tid);
    if (courseId == null) continue;
    const agg = map.get(courseId) || { log: 0, est: 0, n: 0 };
    agg.log += +rec.mins || 0;
    agg.est += +rec.lastEst || (+rec.mins || 0);
    agg.n += 1;
    map.set(courseId, agg);
  }
  return map;
}

export function courseFactors(tasks) {
  const out = {};
  for (const [courseId, agg] of learnedMap(tasks)) {
    if (agg.est > 0) {
      out[courseId] = { factor: clamp(agg.log / agg.est, 0.4, 2.5), logged: Math.round(agg.log), n: agg.n || 0 };
    }
  }
  return out;
}

function targetMinutes(task, byCourse) {
  let mins = rawEstimate(task);
  const agg = byCourse.get(task.courseId);
  if (agg && agg.est > 0) mins = Math.round(mins * clamp(agg.log / agg.est, 0.4, 2.5));
  return mins;
}

function minute(str) {
  const [h, m] = str.split(":").map(Number);
  return h * 60 + (m || 0);
}

function windowMinutes(start, end) {
  const s = minute(start);
  const e = minute(end);
  return e > s ? e - s : (24 * 60 - s) + e;
}

// Same-day clock segments for a study window. A midnight-crossing window
// (e.g. 22:00–01:00) is a single block that is available from 22:00 to 24:00 and
// again from 00:00 to 01:00 on the same calendar day.
function windowSegments(start, end) {
  const s = minute(start);
  const e = minute(end);
  if (e > s) return [{ startM: s, endM: e }];
  return [
    { startM: s, endM: 1440 },
    { startM: 0, endM: e },
  ];
}

// Every same-day window segment, sorted by start time, for the final placement.
function allSegments(slots) {
  return slots
    .flatMap((s, i) => windowSegments(s.start, s.end).map((seg) => ({ ...seg, label: s.label || `Block ${i + 1}` })))
    .sort((a, b) => a.startM - b.startM);
}

function fmtClock(min) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  const ampm = h >= 12 ? "PM" : "AM";
  const hh = h % 12 === 0 ? 12 : h % 12;
  return `${hh}:${String(m).padStart(2, "0")} ${ampm}`;
}

function breakConfig(c = settings()) {
  const every = +(c.breakEveryMinutes || 0);
  const len = +(c.breakMinutes || 0);
  return { every, len, on: every > 0 && len > 0 };
}

// True if the due time leaves enough room for at least one whole same-day study
// segment to finish before it (i.e. the work can legitimately be done that day).
function windowEndsBeforeDue(slots, dueMins) {
  if (dueMins == null) return false;
  for (const slot of slots) {
    for (const seg of windowSegments(slot.start, slot.end)) {
      if (seg.endM <= dueMins) return true;
    }
  }
  return false;
}

export function generateSchedule(courses, tasks) {
  const conf = settings();
  const slots = conf.studySlots.length ? conf.studySlots : [{ start: "18:00", end: "21:00", label: "Evening" }];

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const { every, len, on } = breakConfig(conf);

  const studyCap = (a) => (on ? Math.max(10, a - Math.floor(a / (every + len)) * len) : a);

  const days = Array.from({ length: HORIZON }, (_, i) => {
    const date = new Date(today);
    date.setDate(today.getDate() + i);
    const avail = Math.min(
      conf.maxStudyMinutesPerDay,
      slots.reduce((sum, s) => sum + windowMinutes(s.start, s.end), 0),
    );
    return {
      index: i,
      date,
      label: i === 0 ? "Today" : i === 1 ? "Tomorrow" : date.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" }),
      available: avail,
      remaining: studyCap(avail),
      slots: [],
    };
  });

  const done = new Set(doneIds());
  const open = tasks.filter((t) => !t.submitted && !done.has(t.id) && daysUntil(t.dueAt) < 30 && t.dueAt);
  const ranked = recommendedOrder(open, courses);
  const byCourse = learnedMap(tasks);

  const exams = ranked.filter((r) => r.task.type === "exam");
  const others = ranked.filter((r) => r.task.type !== "exam");

  function pushEntry(idx, entry, mins) {
    const d = days[idx];
    const take = Math.min(d.remaining, mins);
    if (take < 10) return 0;
    d.slots.push({ ...entry, mins: take });
    d.remaining -= take;
    return take;
  }

  const homeworkEntry = (r) => ({
    kind: "homework",
    what: r.task.courseName ? `${r.task.courseName} — ${r.task.title}` : r.task.title,
    courseId: r.task.courseId,
    taskId: r.task.id,
    priority: r.score,
    labels: r.task.type === "quiz" ? "Quiz: " + r.task.title : "HW: " + r.task.title,
  });

  const studyEntry = (r) => ({
    kind: "study",
    what: r.task.courseName ? `${r.task.courseName} — ${r.task.title}` : r.task.title,
    courseId: r.task.courseId,
    taskId: r.task.id,
    priority: r.score,
    labels: "Test prep",
  });

  // ---- Homework: due day only if a study segment on that day ends before the
  // due time, otherwise the day before. Spill over into earlier days if the full
  // estimate doesn't fit.
  for (const r of others) {
    if (!r.task.dueAt) continue;
    const dueIdx = Math.min(HORIZON - 1, Math.max(0, daysUntil(r.task.dueAt)));
    const dueMins = dueTimeOfDay(r.task.dueAt);
    const target = windowEndsBeforeDue(slots, dueMins) ? dueIdx : dueIdx - 1;
    const startDay = Math.max(0, Math.min(target, HORIZON - 1));
    const need = targetMinutes(r.task, byCourse);
    let placed = 0;
    for (let i = startDay; i >= 0 && placed < need; i--) {
      const took = pushEntry(i, homeworkEntry(r), need - placed);
      if (!took) continue;
      placed += took;
    }
  }

  // ---- Exams: ramp up over the 3 days before the exam. A day only participates
  // if it has study time; the exam day itself only if a segment ends before the
  // exam time. Shares of skipped days are folded into the remaining days, never
  // later than the exam.
  for (const r of exams) {
    const dueIdx = Math.min(HORIZON - 1, Math.max(0, daysUntil(r.task.dueAt)));
    const dueMins = dueTimeOfDay(r.task.dueAt);
    const startIdx = Math.max(0, dueIdx - 3);
    const usable = [];
    for (let i = startIdx; i <= dueIdx; i++) {
      if (i === dueIdx && !windowEndsBeforeDue(slots, dueMins)) continue;
      if (!days[i] || days[i].available <= 0) continue;
      usable.push(i);
    }
    if (!usable.length) continue;
    const weights = usable.map((i) => (i === dueIdx ? 0.5 : 1 + (i - startIdx)));
    const wsum = weights.reduce((a, b) => a + b, 0);
    const study = targetMinutes(r.task, byCourse);
    for (let k = 0; k < usable.length; k++) {
      const minutes = Math.round((study * weights[k]) / wsum);
      pushEntry(usable[k], studyEntry(r), minutes);
    }
  }

  // ---- Fill each day's slots into its clock windows (breaks interleaved).
  const windows = allSegments(slots);
  for (const d of days) {
    d.slots.sort((a, b) => b.priority - a.priority);

    const placed = [];
    let cursor = 0;
    let pos = 0;
    let sinceBreak = 0;

    for (const item of d.slots) {
      let need = item.mins;
      while (need > 0 && cursor < windows.length) {
        const w = windows[cursor];
        if (pos < w.startM) pos = w.startM;
        const free = w.endM - pos;
        if (free <= 0) { cursor++; pos = 0; sinceBreak = 0; continue; }

        if (on && sinceBreak >= every && free >= len) {
          placed.push({
            kind: "break",
            what: "Break",
            labels: "Step away, stretch, water",
            mins: len,
            priority: -1,
            start: fmtClock(pos),
            end: fmtClock(pos + len),
          });
          pos += len;
          sinceBreak = 0;
          continue;
        }

        const take = Math.min(need, free);
        placed.push({ ...item, mins: take, start: fmtClock(pos), end: fmtClock(pos + take) });
        pos += take;
        need -= take;
        sinceBreak += take;
        if (pos >= w.endM) { cursor++; pos = 0; sinceBreak = 0; }
      }
    }

    d.slots = placed;
    d.used = placed.reduce((a, s) => a + s.mins, 0);
  }

  return { days, today };
}

export function scheduleSummary(days) {
  const total = days.reduce((a, d) => a + d.used, 0);
  const exams = days.flatMap((d) => d.slots).filter((s) => s.kind === "study").length;
  return { totalMins: total, studySessions: exams };
}