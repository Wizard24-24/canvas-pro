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

function hasStudyTimeOnDay(days, idx) {
  return days[idx] && days[idx].available > 0;
}

function latestStudyWindowBeforeDue(dueIdx, dueMinutesFromMidnight, slots, days) {
  const day = days[dueIdx];
  if (!day) return null;
  for (const s of slots) {
    const startM = minute(s.start);
    const endM = minute(s.end);
    const windowEndsAt = endM > startM ? endM : (24 * 60 - startM) + endM;
    if (windowEndsAt <= dueMinutesFromMidnight) {
      return { startM, endM };
    }
  }
  return null;
}

function findStudySlotForDue(rankedItem, dueIdx, slots, days) {
  const task = rankedItem.task;
  const dueMins = dueTimeOfDay(task.dueAt);
  if (dueMins == null) return dueIdx - 1;
  const window = latestStudyWindowBeforeDue(dueIdx, dueMins, slots, days);
  if (window) return dueIdx;
  return dueIdx - 1;
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

  function placeOnDay(idx, item, placeAtStart) {
    const d = days[idx];
    if (!d || d.remaining < 10) return false;
    const mins = targetMinutes(item.task, byCourse);
    const take = Math.min(d.remaining, mins);
    const entry = {
      kind: item.task.type === "exam" ? "study" : "homework",
      what: item.task.courseName ? `${item.task.courseName} — ${item.task.title}` : item.task.title,
      courseId: item.task.courseId,
      taskId: item.task.id,
      mins: take,
      priority: item.score,
      labels: item.task.type === "exam" ? "Test prep" : item.task.type === "quiz" ? "Quiz: " + item.task.title : "HW: " + item.task.title,
    };
    if (placeAtStart) d.slots.unshift(entry); else d.slots.push(entry);
    d.remaining -= take;
    return take >= mins - 1;
  }

  function findStudySlotForDue(rankedItem, dueIdx) {
    const task = rankedItem.task;
    const dueMins = dueTimeOfDay(task.dueAt);
    if (dueMins == null) return dueIdx - 1;
    const day = days[dueIdx];
    if (!day || day.available === 0) return dueIdx - 1;
    for (const s of slots) {
      const startM = minute(s.start);
      const endM = minute(s.end);
      const windowEndsAt = endM > startM ? endM : (24 * 60 - startM) + endM;
      if (windowEndsAt <= dueMins) {
        return dueIdx;
      }
    }
    return dueIdx - 1;
  }

  for (const r of others) {
    if (!r.task.dueAt) continue;
    const dueIdx = Math.min(HORIZON - 1, Math.max(0, daysUntil(r.task.dueAt)));
    const target = findStudySlotForDue(r, dueIdx);
    const actualTarget = Math.max(0, Math.min(target, dueIdx));
    let placed = placeOnDay(actualTarget, r, false);
    if (!placed) {
      for (let i = actualTarget - 1; i >= 0; i--) {
        if (placeOnDay(i, r, false)) break;
      }
    }
  }

  for (const r of exams) {
    const dueIdx = Math.min(HORIZON - 1, Math.max(0, daysUntil(r.task.dueAt)));
    const startIdx = Math.max(0, dueIdx - 3);
    const range = [];
    for (let i = startIdx; i <= Math.min(dueIdx, HORIZON - 1); i++) range.push(i);
    const weights = range.map((i, k) => (k === range.length - 1 && i === dueIdx ? 0.5 : 1 + k));
    const wsum = weights.reduce((a, b) => a + b, 0);
    const study = targetMinutes(r.task, byCourse);
    for (let k = 0; k < range.length; k++) {
      const idx = range[k];
      if (!days[idx] || days[idx].remaining < 10) continue;
      const minutes = Math.round((study * weights[k]) / wsum);
      if (minutes < 10) continue;
      const d = days[idx];
      const take = Math.min(d.remaining, minutes);
      d.slots.push({
        kind: "study",
        what: `${r.task.courseName} — ${r.task.title}`,
        courseId: r.task.courseId,
        taskId: r.task.id,
        mins: take,
        priority: r.score,
        labels: "Test prep",
      });
      d.remaining -= take;
    }
  }

  for (const d of days) {
    d.slots.sort((a, b) => b.priority - a.priority);

    const windows = slots
      .map((s, i) => ({ ...s, startM: minute(s.start), endM: minute(s.end), label: s.label || `Block ${i + 1}` }))
      .sort((a, b) => a.startM - b.startM);

    let cursor = 0;
    let inWindow = false;
    let currentStart = 0;
    let sinceBreak = 0;
    const placed = [];
    for (const slot of d.slots) {
      while (cursor < windows.length && slot.mins > 0) {
        const w = windows[cursor];
        if (!inWindow) { inWindow = true; currentStart = w.startM; }
        const windowEndM = w.endM > w.startM ? w.endM : (24 * 60 - w.startM) + w.endM;
        const free = windowEndM - currentStart;
        if (free <= 0) { cursor++; inWindow = false; currentStart = 0; continue; }

        if (on && sinceBreak >= every && free >= len) {
          placed.push({
            kind: "break",
            what: "Break",
            labels: "Step away, stretch, water",
            mins: len,
            priority: -1,
            start: fmtClock(currentStart),
            end: fmtClock(currentStart + len),
          });
          currentStart += len;
          sinceBreak = 0;
          continue;
        }

        const take = Math.min(slot.mins, free);
        placed.push({ ...slot, mins: take, start: fmtClock(currentStart), end: fmtClock(currentStart + take) });
        currentStart += take;
        slot.mins -= take;
        sinceBreak += take;
        if (currentStart >= windowEndM) { cursor++; inWindow = false; currentStart = 0; }
      }
    }
    d.slots = placed;
    const total = placed.reduce((a, s) => a + s.mins, 0);
    d.used = total;
  }

  return { days, today };
}

export function scheduleSummary(days) {
  const total = days.reduce((a, d) => a + d.used, 0);
  const exams = days.flatMap((d) => d.slots).filter((s) => s.kind === "study").length;
  return { totalMins: total, studySessions: exams };
}