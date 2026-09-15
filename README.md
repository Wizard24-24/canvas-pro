# Canvas Pro

A smarter, grade-aware view of your Canvas classes. Runs locally on your own
computer — your school data and token never leave your device.

> New here? That's okay. Follow the **Install & Hosting Guide** first:
> [**INSTALL.md**](INSTALL.md) walks you through Mac, Windows, and Linux step by
> step, even if you've never used a terminal. (You can also just cleverly hit
> the 🚀 button above, but read on.)

---

## Quick start

```bash
git clone https://github.com/Wizard24-24/canvas-pro.git
cd canvas-pro
npm start        # opens http://localhost:8000
```

Then paste your Canvas URL + a personal access token. Your token is stored only
in your browser on this device, and only your local server ever talks to Canvas.

---

## Everything it does

**Dashboard** — every class with your current grade vs. your target, a "this
week on Canvas" calendar of everything due in the next 7 days (click any chip to
open it), a Tonight plan, and "do these first" — the ranked shortlist.

**Assignments** — every assignment in every class: type, category weight,
points, due date, and your real grade when it's graded. Mark things done, or add
your own assignments that stick around.

**Tests & Quizzes** — tests kept separate from homework, with study-time
estimates so you know how much an exam is really worth.

**To-Do** — your open work ranked by what actually moves your grade: urgency,
weight, points at stake, and how close you are to your GPA target.

**Late Work** — scans what's overdue, applies your syllabus's late policy, and
sorts by **grade points recovered per minute** so you do the best thing first.

**Grades** — current vs. target for every class, GPA estimate, and a per-course
**what-if calculator**: type a pretend score in for any assignment and watch the
course grade change. Grades are **weighted by category automatically** — the
weights come straight off Canvas (assignment groups), and you can override them
from your syllabus (paste it in **View/Edit Syllabus**, hit *Extract*).

**Study Plan** — a personal weekly schedule. Homework is placed the day before
it's due; test prep ramps over the 3 days before each exam. It scales time by
difficulty and learns from how long you actually spend. Every planned slot is
clickable — it opens the assignment.

**Curve Calc** — see what a curve does to your grade, and (optionally) share
curve history across students.

**AI Assistant** — ask questions in plain English: *"what's my GPA?", "what's
due this week?", "will I pass stats?"* It can look things up in your data live.

**Documents & Announcements** — your course files and latest announcements,
kept in the app.

**Settings** — themes (dark/light, several palettes), your Canvas connection,
what-if targets, syllabus + late-policy editors, cloud curve storage, and the
AI provider.

---

## Privacy

| Data | Where |
|------|-------|
| Canvas access token | This device only (your browser) |
| Classes, grades, assignments | This device (cached locally) |
| Curve logs | This device, + optional cloud you opt into |
| Cloud URL and keys | This device only |

---

## Tech & hosting

Vanilla web app (no frameworks, no build step) with a tiny local Python server
that proxies Canvas for you. That server is why it runs locally — details and
hosting options (LAN, Raspberry Pi, VPS) are in **[INSTALL.md](INSTALL.md)**.

Two version channels via `version.json`: **beta** (new features) and **main**
(stable). See [AGENTS.md](AGENTS.md) for the repo workflow.

---

## Work in progress

Everything lives on the `beta` branch as it's tested; a rollup moves to `main`
when you're happy. Found a bug or want a feature? Drop it in the repo's Issues
or tell your agent — the vault is always watching. 🚀