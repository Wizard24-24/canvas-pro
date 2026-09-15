import os, sys, time, subprocess, socketserver, threading, webbrowser, json, traceback, uuid
import urllib.request, urllib.parse

import http.server

PORT_START = 8000
PROJECT_DIR = os.path.dirname(os.path.abspath(__file__))
os.chdir(PROJECT_DIR)

# ---- Local study agent: bounded per-session memory held on the server ----
AGENT_SESSIONS = {}
AGENT_TOOLS = {
    "list_courses", "list_tasks", "task_detail", "gpa_overview",
    "mark_done", "unmark", "chart",
}

# Installed Ollama model names + capabilities, cached briefly so every agent
# call doesn't re-list the tag catalog. Populated lazily from /api/tags.
OLLAMA_TAGS = {}
OLLAMA_TAGS_TTL = 20.0

# The owner requires this app to always run the beta branch. The server serves
# straight from the checkout, so refuse to start on any other branch and warn
# loudly if the branch is switched while the server is up.
ALLOWED_BRANCH = "beta"

def git_branch():
    """Current git branch name, or None if not a git checkout."""
    try:
        out = subprocess.check_output(
            ["git", "-C", PROJECT_DIR, "rev-parse", "--abbrev-ref", "HEAD"],
            stderr=subprocess.DEVNULL, timeout=5, text=True,
        )
        return out.strip() or None
    except Exception:
        return None

def check_branch_ok(fail_hard=True):
    branch = git_branch()
    if branch is None:
        print("Warning: %s is not a git checkout — cannot enforce the %r branch." % (PROJECT_DIR, ALLOWED_BRANCH))
        return None
    if branch == ALLOWED_BRANCH:
        return branch
    if fail_hard:
        print("Refusing to start: checked out on %r, but this app must run the %r branch." % (branch, ALLOWED_BRANCH))
        print("Fix it:  cd ~/canvas-pro && git checkout %s && npm start" % ALLOWED_BRANCH)
        sys.exit(3)
    return branch

def rewrite_pagelink(value, host):
    """Rewrite Canvas pagination Link header to point back at this proxy."""
    parts = []
    for link in value.split(","):
        link = link.strip()
        m = urllib.parse.urlsplit(link)
        if not m.path:
            continue
        # everything after the host (path?query) becomes the proxied path
        path = m.path
        if m.query:
            path += "?" + m.query
        proxied = "http://" + host + "/api/canvas?p=" + urllib.parse.quote(path, safe="")
        parts.append(f"<{proxied}>; {link.split('>')[1].strip()}" if ";" in link else f"<{proxied}>")
    return ", ".join(parts)

class Handler(http.server.SimpleHTTPRequestHandler):
    server_version = "CanvasPro/0.2"

    def __init__(self, *a, **kw):
        super().__init__(*a, directory=PROJECT_DIR, **kw)

    def end_headers(self):
        # Dev server: never cache, so updated JS always loads without hard refreshes.
        try:
            self.send_header("Cache-Control", "no-store")
        except Exception:
            pass
        super().end_headers()

    def log_message(self, fmt, *args):
        msg = fmt % args
        if "/api/canvas" not in msg:
            sys.stderr.write("  %s\n" % msg)

    # ---- Canvas API proxy (local only; token never leaves this machine) ----
    def _read_body(self):
        length = int(self.headers.get("Content-Length", 0) or 0)
        return self.rfile.read(length) if length else None

    def do_CANVAS(self, method="GET", body=None):
        parsed = urllib.parse.urlsplit(self.path)
        qs = urllib.parse.parse_qs(parsed.query)
        canvas_path = qs.get("p", [""])[0]
        token = self.headers.get("X-Canvas-Token", "")
        base = self.headers.get("X-Canvas-Base", "").rstrip("/")

        if not canvas_path or not token or not base:
            self.send_error(400, "Missing p / X-Canvas-Token / X-Canvas-Base")
            return

        target = base + canvas_path
        headers = {"Authorization": "Bearer " + token}
        ct = self.headers.get("Content-Type")
        if ct:
            headers["Content-Type"] = ct
        req = urllib.request.Request(target, data=body, method=method, headers=headers)
        try:
            resp = urllib.request.urlopen(req, timeout=60)
        except urllib.error.HTTPError as e:
            body_resp = e.read()
            self.send_response(e.code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body_resp)))
            self.end_headers()
            self.wfile.write(body_resp)
            return
        except Exception as e:
            self.send_error(502, "Proxy to Canvas failed: %s" % e)
            return

        body_out = resp.read()
        self.send_response(resp.status)
        self.send_header("Content-Type", resp.headers.get_content_type() or "application/json")
        rel = resp.headers.get("Link")
        if rel:
            host = self.headers.get("Host", "localhost:" + str(PORT_START))
            self.send_header("Link", rewrite_pagelink(rel, host))
        self.send_header("Content-Length", str(len(body_out)))
        self.end_headers()
        self.wfile.write(body_out)

    # ---- file download passthrough (token-authenticated, streams bytes) ----
    def do_DL(self):
        parsed = urllib.parse.urlsplit(self.path)
        qs = urllib.parse.parse_qs(parsed.query)
        u = qs.get("u", [""])[0]
        token = self.headers.get("X-Canvas-Token", "")
        if not u or not token:
            self.send_error(400, "Missing u / X-Canvas-Token")
            return
        req = urllib.request.Request(u, headers={"Authorization": "Bearer " + token})
        try:
            resp = urllib.request.urlopen(req, timeout=120)
        except urllib.error.HTTPError as e:
            body = e.read()
            self.send_response(e.code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        except Exception as e:
            self.send_error(502, "File proxy failed: %s" % e)
            return
        data = resp.read()
        self.send_response(resp.status)
        self.send_header("Content-Type", resp.headers.get_content_type() or "application/octet-stream")
        self.send_header("Content-Disposition", "inline")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path.startswith("/api/canvas") or self.path.startswith("/api/canvas?"):
            return self.do_CANVAS()
        if self.path.startswith("/api/dl?") or self.path.startswith("/api/dl"):
            return self.do_DL()
        return super().do_GET()

    def do_POST(self):
        if self.path.startswith("/api/ai"):
            return self.do_AI()
        if self.path.startswith("/api/agent"):
            return self.do_AGENT()
        if self.path.startswith("/api/ul"):
            return self.do_UL()
        if self.path.startswith("/api/canvas"):
            return self.do_CANVAS(method="POST", body=self._read_body())
        return super().do_POST()

    def do_PUT(self):
        if self.path.startswith("/api/canvas"):
            return self.do_CANVAS(method="PUT", body=self._read_body())
        return super().do_PUT()

    def do_DELETE(self):
        if self.path.startswith("/api/canvas"):
            return self.do_CANVAS(method="DELETE", body=self._read_body())
        return super().do_DELETE()

    def do_AI(self):
        try:
            self._do_ai_impl()
        except Exception as e:
            print("AI route error:", traceback.format_exc())
            self.send_error(500, "AI proxy internal error")
        finally:
            try:
                self.wfile.flush()
            except Exception:
                pass

    def _send_json(self, code, data, ctype="application/json"):
        self.send_response(code)
        self.send_header("Content-Type", ctype or "application/json; charset=utf-8")
        sess = getattr(self, "_ai_session", None)
        if sess:
            self.send_header("X-AI-Session", str(sess))
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _do_ai_impl(self):
        provider = (self.headers.get("X-AI-Provider") or "openai").lower()
        if provider == "opencode":
            return self._do_opencode()
        body = self._read_body()
        url = self.headers.get("X-AI-Url", "").strip()
        if not url:
            return self.send_error(400, "Missing X-AI-Url header")
        headers = {
            "Content-Type": "application/json",
            "Accept": "application/json",
        }
        key = self.headers.get("X-AI-Key", "").strip()
        if key:
            headers["Authorization"] = "Bearer " + key
        req = urllib.request.Request(url, data=body, method="POST", headers=headers)
        try:
            resp = urllib.request.urlopen(req, timeout=240)
        except urllib.error.HTTPError as e:
            err = e.read()[:2000]
            return self._send_json(e.code, err, (e.headers.get("Content-Type") or "application/json").split(";")[0])
        except Exception as e:
            return self.send_error(502, "AI upstream error: " + str(e)[:200])
        data = resp.read()
        self._send_json(resp.getcode() or 200, data, (resp.headers.get("Content-Type") or "application/json").split(";")[0])

    def _do_opencode(self):
        body = self._read_body()
        base = (self.headers.get("X-AI-Url") or "http://localhost:4096").strip().rstrip("/")
        sid = (self.headers.get("X-AI-Session") or "").strip()
        payload = {}
        try:
            payload = json.loads(body)
        except Exception:
            pass
        msgs = payload.get("messages") or []
        last_user = ""
        for m in reversed(msgs):
            c = m.get("content")
            if m.get("role") == "user" and isinstance(c, str) and c.strip():
                last_user = c
                break
        model = payload.get("model")

        resp = None
        for attempt in (1, 2):
            try:
                if not sid:
                    sid = self._oc_create(base)
                msgbody = {"parts": [{"type": "text", "text": last_user or "(empty prompt)"}]}
                if model:
                    msgbody["model"] = model
                resp = self._oc_post(base, sid, msgbody)
                break
            except urllib.error.HTTPError as e:
                if e.code == 404 and attempt == 1:
                    self._oc_delete(base, sid)
                    sid = ""
                    continue
                err = e.read()[:2000]
                return self._send_json(e.code, err or json.dumps({"error": {"message": "opencode HTTP " + str(e.code)}}).encode())
            except Exception as e:
                return self.send_error(502, "Cannot reach opencode serve at %s (%s). Start it with `opencode serve`." % (base, str(e)[:120]))
        self._ai_session = sid
        parts = (resp or {}).get("parts") or []
        texts = [p.get("text", "") for p in parts if p.get("type") == "text" and (p.get("text") or "").strip()]
        reply = "\n".join(texts).strip() or "(no text reply from opencode)"
        self._send_json(200, json.dumps({"choices": [{"message": {"role": "assistant", "content": reply}}]}).encode(), "application/json")

    def _oc_create(self, base):
        req = urllib.request.Request(base + "/session", data=b'{"title":"Canvas Pro"}',
                                     headers={"Content-Type": "application/json", "Accept": "application/json"}, method="POST")
        with urllib.request.urlopen(req, timeout=30) as r:
            sess = json.loads(r.read())
        return (sess or {}).get("id")

    def _oc_delete(self, base, sid):
        try:
            urllib.request.urlopen(urllib.request.Request(base + "/session/" + sid, method="DELETE"), timeout=15)
        except Exception:
            pass

    def _oc_post(self, base, sid, msgbody):
        req = urllib.request.Request(base + "/session/" + sid + "/message", data=json.dumps(msgbody).encode(),
                                     headers={"Content-Type": "application/json", "Accept": "application/json"}, method="POST")
        with urllib.request.urlopen(req, timeout=900) as r:
            return json.loads(r.read())

    # ---- Canvas file upload relay ----
    # The browser builds the multipart form (Canvas upload_params + the file)
    # and POSTs it here; we pass the raw bytes straight through to Canvas's
    # upload_url so no cross-origin rules apply and the token never leaves us.
    def do_UL(self):
        parsed = urllib.parse.urlsplit(self.path)
        qs = urllib.parse.parse_qs(parsed.query)
        u = qs.get("u", [""])[0]
        ct = (self.headers.get("Content-Type") or "").strip()
        if not u or not ct:
            self.send_error(400, "Missing u / Content-Type")
            return
        body = self._read_body() or b""
        req = urllib.request.Request(u, data=body, method="POST", headers={"Content-Type": ct})
        try:
            resp = urllib.request.urlopen(req, timeout=600)
        except urllib.error.HTTPError as e:
            b = e.read()
            self.send_response(e.code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(b)))
            self.end_headers()
            self.wfile.write(b)
            return
        except Exception as e:
            self.send_error(502, "Upload relay failed: %s" % e)
            return
        data = resp.read()
        self.send_response(resp.status)
        self.send_header("Content-Type", resp.headers.get_content_type() or "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    # ---- Local agent (Ollama on this machine) with memory + Canvas tools ----
    def do_AGENT(self):
        try:
            out = self._do_agent_impl()
        except Exception as e:
            print("Agent route error:", traceback.format_exc())
            self.send_error(500, "Agent internal error")
            return
        data = json.dumps(out).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        sid = out.get("sessionId") or ""
        if sid:
            self.send_header("X-AI-Session", sid)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _canvas_get_json(self, token, base, path, timeout=60):
        url = base.rstrip("/") + path
        req = urllib.request.Request(url, headers={"Authorization": "Bearer " + token})
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read())

    def _ollama_tags(self, ollama):
        # Installed model names + capabilities from the Ollama catalog.
        # Falls back to an empty catalog if Ollama isn't reachable, so the
        # chat path still produces a clear error instead of a crash.
        key = ollama.rstrip("/")
        now = time.time()
        cached = OLLAMA_TAGS.get(key)
        if cached and now - cached[0] < OLLAMA_TAGS_TTL:
            return cached[1], cached[2]
        names, caps = [], {}
        try:
            req = urllib.request.Request(key + "/api/tags")
            with urllib.request.urlopen(req, timeout=8) as r:
                data = json.loads(r.read())
            for m in data.get("models") or []:
                nm = (m.get("name") or "").strip()
                if not nm:
                    continue
                names.append(nm)
                caps[nm] = set(m.get("capabilities") or [])
        except Exception:
            pass
        names.sort()
        OLLAMA_TAGS[key] = (now, names, caps)
        return names, caps

    def _ollama_model_order(self, ollama, requested):
        # Build the list of models to try, in order: the explicitly requested
        # one first if the client asked for something specific, then every
        # installed model that advertises tool support (the agent needs tools),
        # then the rest. "auto" (or a name Ollama doesn't have) just picks
        # whatever tool-capable model is installed.
        names, caps = self._ollama_tags(ollama)
        want = (requested or "auto").strip()
        ordered = []
        seen = set()

        def push(n):
            if n and n not in seen:
                seen.add(n)
                ordered.append(n)

        if want and want != "auto" and want in names:
            push(want)
        with_tools = [n for n in names if "tools" in caps.get(n, set())]
        for n in with_tools + [n for n in names if "tools" not in caps.get(n, set())]:
            push(n)
        return ordered

    def _ollama_chat(self, ollama, model, messages):
        candidates = self._ollama_model_order(ollama, model)
        last_err = None
        for m in candidates:
            out = self._ollama_chat_one(ollama, m, messages)
            if out.startswith("Tool backend error: HTTP 404"):
                last_err = out
                continue
            return out
        if last_err:
            return last_err
        return ("No Ollama model available at %s. Install Ollama, then pull one, "
                "e.g.  ollama pull gemma4:31b-cloud" % ollama.rstrip("/"))

    def _ollama_chat_one(self, ollama, model, messages):
        payload = {
            "model": model, "messages": messages, "stream": False,
            "options": {"temperature": 0.4},
        }
        req = urllib.request.Request(
            ollama.rstrip("/") + "/api/chat", data=json.dumps(payload).encode(),
            headers={"Content-Type": "application/json"}, method="POST")
        try:
            with urllib.request.urlopen(req, timeout=240) as r:
                data = json.loads(r.read())
        except urllib.error.HTTPError as e:
            note = e.read()[:300]
            return "Tool backend error: HTTP %s — %s" % (e.code, note.decode("utf-8", "replace"))
        except Exception as e:
            return "Can't reach the local Ollama model at %s. Is Ollama running with %s pulled? (%s)" % (ollama, model, str(e)[:120])
        msg = (data.get("message") or {}).get("content") or ""
        return msg.strip() or "(empty reply from model)"

    def _do_agent_impl(self):
        body = self._read_body() or b""
        payload = {}
        try:
            payload = json.loads(body)
        except Exception:
            pass
        token = (self.headers.get("X-AI-Token") or "").strip()
        base = (self.headers.get("X-AI-Base") or "").strip().rstrip("/")
        ollama = (self.headers.get("X-AI-Ollama") or "http://localhost:11434").strip().rstrip("/")
        model = (self.headers.get("X-AI-Model") or "auto").strip()
        sid = (self.headers.get("X-AI-Session") or "").strip()
        reset = bool(payload.get("reset"))
        text = str(payload.get("message") or "").strip()
        done_set = set(payload.get("doneIds") or [])

        if reset or (sid and sid not in AGENT_SESSIONS):
            AGENT_SESSIONS.pop(sid, None)
            sid = ""
        if not sid:
            sid = uuid.uuid4().hex[:16]
        sess = AGENT_SESSIONS.setdefault(sid, {
            "messages": [], "token": token, "base": base, "ollama": ollama, "model": model,
        })
        # Refresh credentials on every call so reconnects keep working.
        sess["token"], sess["base"], sess["ollama"], sess["model"] = token, base, ollama, model
        # Trim long sessions (simple memory bound).
        sess["messages"] = (sess["messages"] or [])[-40:]

        self._prune_sessions()

        if (payload.get("history") or []) and not sess["messages"]:
            for h in payload.get("history") or []:
                if isinstance(h, dict) and h.get("content"):
                    sess["messages"].append({"role": "user" if h.get("role") == "assistant" else "assistant" if h.get("role") == "bot" else "user", "content": str(h.get("content"))})

        if not text and not reset:
            return {"text": "Nothing to do — send a message.", "actions": [], "sessionId": sid}

        messages = [{"role": "system", "content": self._agent_system_prompt()}]
        messages.extend(sess["messages"])
        if text:
            messages.append({"role": "user", "content": text})
        if not sess["messages"] and text:
            sess["messages"].append({"role": "user", "content": text})
        if reset and not text:
            return {"text": "Chat cleared. New session, fresh start — ask me anything.", "actions": [], "sessionId": sid}

        final = None
        for round_i in range(4):
            reply = self._ollama_chat(ollama, model, messages)
            call = self._extract_tool_call(reply)
            if call is None:
                final = reply
                break
            name = call.get("tool")
            args = call.get("args") if isinstance(call.get("args"), dict) else {}
            result = self._exec_agent_tool(name, args, sess, done_set)
            actions = result.get("clientActions") or []
            out_text = result.get("reply") or "(done)"
            messages.append({"role": "assistant", "content": reply[:1500]})
            messages.append({"role": "tool", "content": out_text[:3000]})
            sess["messages"].append({"role": "assistant", "content": reply[:1500]})
            sess["messages"].append({"role": "tool", "content": out_text[:1000]})
            sess["messages"] = sess["messages"][-40:]
            if actions:
                # The model asked the app to do something client-side (mark done, chart).
                return {"text": self._trim(reply) + "\n\n" + out_text, "actions": actions, "sessionId": sid}
        if final is None:
            final = "I did more than a few tool steps and stopped. Ask a simpler question, or say “clear chat” to reset."
        return {"text": self._trim(final), "actions": [], "sessionId": sid}

    def _agent_system_prompt(self):
        return (
            "You are the study agent running inside the user's local Canvas Pro app. "
            "You have memory of this conversation and tools that can read the user's Canvas data and take small actions.\n"
            "When you need data or want to act, reply with EXACTLY one JSON object on its own line, like:\n"
            '{"tool":"list_tasks","args":{}}\n'
            "After you get the tool result, continue — answer in plain text or call the next tool.\n"
            "Available tools:\n"
            '- {"tool":"list_courses","args":{}} — list active courses with score + letter grade\n'
            '- {"tool":"list_tasks","args":{}} — list open, not-yet-submitted assignments\n'
            '- {"tool":"task_detail","args":{"title":"…"}} or {"id":"…"} — details for one assignment\n'
            '- {"tool":"gpa_overview","args":{}} — current unweighted GPA by course\n'
            '- {"tool":"mark_done","args":{"title":"…"}} — mark an assignment done so the app stops planning it\n'
            '- {"tool":"unmark","args":{"title":"…"}} — undo a mark_done\n'
            '- {"tool":"chart","args":{"what":"grades"}} or {"what":"tasks"} — returns an SVG chart\n'
            "Rules: be concise and practical. Never invent numbers — use tool results. "
            "If no tool is needed, answer directly in plain markdown text. Normal subjects, study questions, "
            "and explanations need no tools."
        )

    @staticmethod
    def _extract_tool_call(text):
        i = text.find("{")
        while i != -1:
            depth = 0
            for j in range(i, len(text)):
                ch = text[j]
                if ch == "{":
                    depth += 1
                elif ch == "}":
                    depth -= 1
                    if depth == 0:
                        try:
                            obj = json.loads(text[i:j + 1])
                        except Exception:
                            break
                        if isinstance(obj, dict) and isinstance(obj.get("tool"), str) and obj["tool"] in AGENT_TOOLS:
                            return obj
                        break
            i = text.find("{", i + 1)
        return None

    @staticmethod
    def _trim(s, n=2600):
        s = (s or "").strip()
        return s if len(s) <= n else s[:n].rsplit(" ", 1)[0] + "…"

    def _exec_agent_tool(self, name, args, sess, done_set):
        token, base = sess.get("token", ""), sess.get("base", "")
        try:
            if name == "list_courses":
                courses = self._canvas_get_json(token, base, "/api/v1/courses?enrollment_state=active&include[]=total_scores")
                if not courses:
                    return {"reply": "No active courses found."}
                lines = []
                for c in courses:
                    grades = {}
                    enrol = [e for e in (c.get("enrollments") or []) if "student" in (e.get("type") or "")]
                    if enrol:
                        grades = enrol[0].get("grades") or {}
                    score = (enrol[0].get("computed_current_score") if enrol else None) or grades.get("current_score")
                    letter = (enrol[0].get("computed_current_grade") if enrol else None) or grades.get("current_grade")
                    lines.append("- %s: %s%% %s" % (c.get("name") or "?", "" if score is None else round(float(score), 1), letter or "(no letter)"))
                return {"reply": "Courses:\n" + "\n".join(lines)}
            if name == "list_tasks":
                todo = self._canvas_get_json(token, base, "/api/v1/users/self/todo?include[]=course")
                items = todo if isinstance(todo, list) else []
                if not items:
                    return {"reply": "No open to-dos right now. Nice."}
                lines = []
                for t in items[:20]:
                    a = t.get("assignment") or {}
                    course = t.get("context_name") or t.get("course_name") or "?"
                    due = a.get("due_at") or t.get("due_at") or "no due date"
                    lines.append("- %s (%s) — %s pts, due %s" % (a.get("name") or "?", course, a.get("points_possible") or "?", due))
                return {"reply": "Open tasks (%d shown of %d):\n%s" % (len(lines), len(items), "\n".join(lines))}
            if name == "task_detail":
                todo = self._canvas_get_json(token, base, "/api/v1/users/self/todo?include[]=course")
                needle = str(args.get("title") or args.get("id") or "").lower().strip()
                found = None
                for t in todo if isinstance(todo, list) else []:
                    a = t.get("assignment") or {}
                    if needle and needle in str(a.get("name") or "").lower():
                        found = t
                        break
                if found is None:
                    return {"reply": "Couldn't find that task. Try list_tasks first, then task_detail with the exact title."}
                a = found.get("assignment") or {}
                course = found.get("context_name") or "?"
                return {"reply": "%s (%s)\n- Points: %s\n- Due: %s\n- Course: %s\n- HTML: %s" % (
                    a.get("name") or "?", a.get("submission_types") or "?",
                    a.get("points_possible") or "?", a.get("due_at") or "?",
                    course, a.get("html_url") or "https://canvas.instructure.com")}
            if name == "gpa_overview":
                courses = self._canvas_get_json(token, base, "/api/v1/courses?enrollment_state=active&include[]=total_scores")
                scale = {"A+": 4.0, "A": 4.0, "A-": 3.7, "B+": 3.3, "B": 3.0, "B-": 2.7,
                         "C+": 2.3, "C": 2.0, "C-": 1.7, "D+": 1.3, "D": 1.0, "D-": 0.7, "F": 0.0}
                rows = []
                total = 0.0
                count = 0
                for c in courses:
                    enrol = [e for e in (c.get("enrollments") or []) if "student" in (e.get("type") or "")]
                    grades = enrol[0].get("grades") or {} if enrol else {}
                    letter = ((enrol[0].get("computed_current_grade") if enrol else None) or grades.get("current_grade") or "").upper().strip()
                    score = ((enrol[0].get("computed_current_score") if enrol else None) or grades.get("current_score"))
                    if not letter and score is not None:
                        s = float(score)
                        letter = ("A+" if s >= 97 else "A" if s >= 93 else "A-" if s >= 90 else
                                  "B+" if s >= 87 else "B" if s >= 83 else "B-" if s >= 80 else
                                  "C+" if s >= 77 else "C" if s >= 73 else "C-" if s >= 70 else
                                  "D+" if s >= 67 else "D" if s >= 63 else "D-" if s >= 60 else "F")
                    pts = scale.get(letter)
                    if pts is None:
                        continue
                    total += pts
                    count += 1
                    rows.append("- %s: %s (%s%%)" % (c.get("name") or "?", letter, "" if score is None else round(float(score), 1)))
                gpa = (total / count) if count else 0.0
                return {"reply": "Unweighted GPA (from %d graded classes): %.2f\n%s" % (count, gpa, "\n".join(rows))}
            if name in ("mark_done", "unmark"):
                done = name == "mark_done"
                todo = self._canvas_get_json(token, base, "/api/v1/users/self/todo?include[]=course")
                needle = str(args.get("title") or args.get("id") or "").lower().strip()
                target = None
                for t in todo if isinstance(todo, list) else []:
                    a = t.get("assignment") or {}
                    if a.get("id") is not None and str(a.get("id")) == needle:
                        target = t
                        break
                if target is None:
                    for t in todo if isinstance(todo, list) else []:
                        a = t.get("assignment") or {}
                        if needle and needle in str(a.get("name") or "").lower():
                            target = t
                            break
                if target is None:
                    return {"reply": "Couldn't match that assignment. Use list_tasks first and repeat the exact title."}
                a = target.get("assignment") or {}
                local_id = "%s-%s" % (target.get("course_id"), a.get("id"))
                return {"reply": "OK — marked “%s” as %s." % (a.get("name"), "done" if done else "open"),
                        "clientActions": [{"type": "setDone", "id": local_id, "done": done, "title": a.get("name")}]}
            if name == "chart":
                what = str(args.get("what") or "grades").lower()
                if what == "tasks":
                    todo = self._canvas_get_json(token, base, "/api/v1/users/self/todo?include[]=course")
                    counts = {}
                    for t in todo if isinstance(todo, list) else []:
                        course = t.get("context_name") or t.get("course_name") or "Course"
                        counts[course] = counts.get(course, 0) + 1
                    svg = _svg_bar_chart("Open tasks by course", list(counts.keys()), list(counts.values()))
                    return {"reply": "Chart rendered.", "clientActions": [{"type": "chart", "svg": svg, "title": "Open tasks by course"}]}
                courses = self._canvas_get_json(token, base, "/api/v1/courses?enrollment_state=active&include[]=total_scores")
                labels, values = [], []
                for c in courses:
                    enrol = [e for e in (c.get("enrollments") or []) if "student" in (e.get("type") or "")]
                    grades = enrol[0].get("grades") or {} if enrol else {}
                    score = ((enrol[0].get("computed_current_score") if enrol else None) or grades.get("current_score"))
                    if score is None:
                        continue
                    labels.append(c.get("name") or "?")
                    values.append(float(score))
                if not values:
                    return {"reply": "No graded courses to chart yet."}
                svg = _svg_bar_chart("Current grades (%)", labels, values)
                return {"reply": "Chart rendered.", "clientActions": [{"type": "chart", "svg": svg, "title": "Current grades (%)"}]}
            return {"reply": "Unknown tool: %s" % name}
        except Exception as e:
            return {"reply": "Tool %s failed: %s" % (name, str(e)[:200])}

    def _prune_sessions(self, cap=50):
        if len(AGENT_SESSIONS) > cap:
            for k in list(AGENT_SESSIONS)[:len(AGENT_SESSIONS) - cap]:
                AGENT_SESSIONS.pop(k, None)

    def _ai_session_setter(self):  # kept for symmetry
        return None

def pick_port():
    for port in range(PORT_START, PORT_START + 20):
        try:
            with socketserver.TCPServer(("0.0.0.0", port), Handler) as probe:
                pass
        except OSError:
            continue
        return port
    return None

def main():
    branch = check_branch_ok(fail_hard=True)
    print("Serving branch: %s" % branch, flush=True)

    port = pick_port()
    if port is None:
        print("No free port found in 8000-8019. Close something and retry.")
        sys.exit(1)

    class ThreadingServer(socketserver.ThreadingTCPServer):
        allow_reuse_address = True
        daemon_threads = True

    httpd = ThreadingServer(("0.0.0.0", port), Handler)
    url = f"http://localhost:{port}"
    print(f"\nCanvas Pro is running at  {url}", flush=True)
    print("Keep this window open. Press Ctrl+C to stop.\n", flush=True)

    def watchdog():
        # Branch paths mid-run: the site serves whatever the checkout has, so
        # shout if it ever stops being beta.
        while True:
            time.sleep(5)
            b = check_branch_ok(fail_hard=False)
            if b is not None and b != ALLOWED_BRANCH:
                print("\n!!! Git checkout changed to %r — this site is now serving NON-BETA code. Run  git checkout %s  to fix it.\n" % (b, ALLOWED_BRANCH), flush=True)

    threading.Thread(target=watchdog, daemon=True).start()
    threading.Timer(0.6, lambda: webbrowser.open(url)).start()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")

def _svg_bar_chart(title, labels, values, width=640, height=330):
    """Simple server-side bar chart (no deps). Returns an SVG string."""
    if not labels or not values:
        return ""
    import math
    n = len(labels)
    ml, mr, mt, mb = 46, 18, 34, 66
    cw, ch = width - ml - mr, height - mt - mb
    vmin, vmax = min(values), max(values)
    lo = vmin if vmin >= 0 else 0
    span = (vmax - lo) or 1.0
    pad = span * 0.12
    top, bottom = vmax + pad, lo
    def yr(v):
        return mt + ch * (bottom - v) / (top - bottom or 1)
    palette = ["#6c8cff", "#9d6cff", "#3ecf8e", "#f2c14e", "#f2486e", "#21b8c9", "#b06cff", "#ff8f3c"]
    bars_w = cw / n
    step = int(math.ceil(n / 20.0))
    parts = []
    parts.append('<svg xmlns="http://www.w3.org/2000/svg" width="%d" height="%d" viewBox="0 0 %d %d" font-family="-apple-system,Segoe UI,sans-serif">' % (width, height, width, height))
    parts.append('<rect x="0" y="0" width="%d" height="%d" fill="rgba(13,17,29,0.92)"/>' % (width, height))
    parts.append('<text x="%d" y="22" fill="#e6e6ea" font-size="15" font-weight="600">%s</text>' % (ml, esc_xml(title)))
    # gridlines
    for i in range(5):
        f = i / 4.0
        v = top - (top - bottom) * f
        y = yr(v)
        parts.append('<line x1="%d" x2="%d" y1="%.1f" y2="%.1f" stroke="rgba(255,255,255,0.08)"/>' % (ml, width - mr, y, y))
        parts.append('<text x="%d" y="%.1f" fill="#8a8f9d" font-size="10" text-anchor="end">%.0f</text>' % (ml - 6, y + 3, v))
    # bars
    for i, (lab, val) in enumerate(zip(labels, values)):
        h = ch * (val - bottom) / (top - bottom or 1)
        if h < 0:
            h = 0
        w = bars_w * 0.62
        x = ml + i * bars_w + (bars_w - w) / 2
        y = yr(val)
        color = palette[i % len(palette)]
        parts.append('<rect x="%.1f" y="%.1f" width="%.1f" height="%.1f" rx="4" fill="%s"/>' % (x, y, w, h, color))
        parts.append('<text x="%.1f" y="%.1f" fill="#fff" font-size="10" font-weight="600" text-anchor="middle">%.0f</text>' % (x + w / 2, y - 4, val))
        short = (lab if len(lab) <= 16 else lab[:14] + "…") if i % step == 0 else ""
        if short:
            parts.append('<text x="%.1f" y="%d" fill="#b8bcc9" font-size="10" text-anchor="middle" transform="rotate(-28 %.1f %d)">%s</text>' % (x + w / 2, height - mb + 16, x + w / 2, height - mb + 16, esc_xml(short)))
    parts.append("</svg>")
    return "".join(parts)

def esc_xml(s):
    return (str(s).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;"))

if __name__ == "__main__":
    main()