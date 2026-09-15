# Install & Hosting Guide (for absolute beginners)

Welcome! This guide assumes you have **never** used GitHub, a terminal, or a
command line before. Everything you need is here, for **Mac**, **Windows**, and
**Linux**. Go slowly, follow the section for your computer, and copy-paste the
exact commands.

---

## What you're installing

Canvas Pro is a student dashboard for Canvas (like Canvas's own homepage, but
smarter). It runs **on your own computer** using a small local web server.

It needs three things installed:

| Tool | Why |
|------|-----|
| **Python 3** | Runs the small server app |
| **Node.js** | Just a convenient launcher for the server |
| **Git** (optional) | Downloads the code from GitHub |

If you don't want to install Git, you can instead click **Code → Download ZIP**
on the GitHub page and unzip it. Both ways work — Git just makes updates easier.

---

## Step 0 — Get the code

**Option A (recommended, uses Git):** later, when your terminal is ready, run:

```bash
git clone https://github.com/Wizard24-24/canvas-pro.git
```

**Option B (no Git):** open https://github.com/Wizard24-24/canvas-pro in your
browser → green **Code** button → **Download ZIP** → unzip it into a folder
called `canvas-pro`.

---

# macOS

### 1. Install Apple's command-line tools (gives you Git)

Open **Terminal** (press <kbd>⌘</kbd>+<kbd>Space</kbd>, type "Terminal", press Enter).

Paste this and press Enter:

```bash
xcode-select --install
```

A window pops up — click **Install** and wait for it to finish (it can take a few minutes).

### 2. Install Python 3

Check if Python is already there:

```bash
python3 --version
```

If it prints something like `Python 3.11` you're done with this step.
If it says `command not found`:

1. Go to https://python.org → **Downloads** → download the latest **macOS 64-bit installer**.
2. Run the installer. On the first screen tick **"Install Python to PATH"**, then click through to done.

### 3. Install Node.js

Go to https://nodejs.org → download the **LTS** version → run the installer and
click through with the defaults.

### 4. Download the code & start it

In Terminal:

```bash
cd ~/Downloads
git clone https://github.com/Wizard24-24/canvas-pro.git
cd canvas-pro
npm start
```

A browser window will open at **http://localhost:8000**. Keep the Terminal
window open — closing it stops the app.

> **Not using Git?** Unzip the ZIP into `~/Downloads`, then instead run
> `cd ~/Downloads/canvas-pro` and `npm start`.

---

# Windows

### 1. Open a terminal

Press the **Start** button, type `PowerShell`, click **Windows PowerShell**.
Right-click it and choose **Run as administrator** if your account is not the
main one — otherwise just open it normally.

### 2. Install Python 3

1. Go to https://python.org → **Downloads** → the big **Download Python** button.
2. Run the installer. **Important:** tick the box **"Add python.exe to PATH"**
   at the bottom of the first screen, then click **Install Now**.

### 3. Install Node.js

Go to https://nodejs.org → **LTS** → run the installer with the defaults.

### 4. Install Git (optional)

Go to https://git-scm.com → **Download for Windows** → run the installer,
clicking **Next** through all defaults.

### 5. Download the code & start it

In PowerShell:

```powershell
cd $HOME\Downloads
git clone https://github.com/Wizard24-24/canvas-pro.git
cd canvas-pro
npm start
```

A browser window will open at **http://localhost:8000**. Keep the PowerShell
window open.

> **Not using Git?** Unzip the ZIP into `Downloads`, then run
> `cd $HOME\Downloads\canvas-pro` and `npm start`.
> If Windows shows a firewall prompt for Python, click **Allow access** on your
> private network (it's the local app server).

---

# Linux (Ubuntu / Debian — including Raspberry Pi)

### 1. Open a terminal

Press <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>T</kbd>.

### 2. Install everything in one shot

```bash
sudo apt update
sudo apt install -y git python3 python3-venv nodejs npm
```

If you're on a non-Debian distro (Fedora/Arch), search "install git python3
nodejs" for your package manager — this guide assumes apt.

### 3. Download the code & start it

```bash
cd ~
git clone https://github.com/Wizard24-24/canvas-pro.git
cd canvas-pro
npm start
```

A browser window will open at **http://localhost:8000**. Keep the terminal open.

> **Not using Git?** Unzip the ZIP into your home folder, then run
> `cd ~/canvas-pro` and `npm start`.

---

# Connect to your Canvas account

1. In the app's first screen ("Connect to Canvas"), paste your school's Canvas
   address, e.g. **https://djusd.instructure.com**.
2. Create an access token:
   - Open Canvas → **Account** (left menu) → **Settings** → scroll to
     **Approved Integrations / Access Token** → **+ New Access Token**.
   - Give it any name (e.g. "Canvas Pro") and leave the expiry blank for "no
     expiry". **Copy the token immediately** — Canvas only shows it once.
3. Paste the token into the app and click **Connect**.

Your token is stored **only in your browser on this device** and is only sent to
the local server on your machine, which talks to Canvas for you. It is never
uploaded anywhere.

---

# Everyday use

- To start the app: open a terminal, `cd canvas-pro`, and run `npm start`.
- To stop it: press <kbd>Ctrl</kbd>+<kbd>C</kbd> in that terminal.
- The app auto-opens your browser; if it doesn't, open
  **http://localhost:8000** manually.
- It uses ports **8000–8019**; if one is busy it tries the next automatically.

---

# Hosting (running it somewhere other than your own laptop)

The app is built to run **locally on your machine** — that's how it keeps your
Canvas token private. "Hosting" options, easiest first:

### 1. On your own network (phone + tablet support)

The server already listens on your network. Find your computer's IP address:

- **Mac/Linux:** in the terminal run `ipconfig getifaddr en0` (Mac) or
  `hostname -I` (Linux).
- **Windows:** run `ipconfig` and look for "IPv4 Address".

Then from your phone on the same Wi-Fi open **http://<that-IP>:8000**. On Mac,
allow the firewall prompt to let connections through.

> **Security note:** this exposes the app on your Wi-Fi. Anyone on the same
> network could use it. Only do this on your home network, **not** public school
> Wi-Fi. Turn it off (Ctrl+C) when you're done.

### 2. A small always-on computer you own (Raspberry Pi / old laptop)

Install the app on the Pi (the Linux steps above work) and leave it running.
Point your browser at the Pi's IP:8000. Same network, always available. If you
want it to restart when the Pi reboots, Google "systemd service" for a
beginner-friendly walkthrough.

### 3. A cloud server (VPS)

You can rent a tiny Linux server (e.g. Oracle Cloud Free Tier, or any cheap
VPS) and run the Linux steps above over SSH. This makes the app reachable on
the internet, so:

- Use **HTTPS** (put it behind Cloudflare, or add TLS). Otherwise your token
  travels in plain text.
- This is advanced — do this only if you're comfortable with servers.

### What about GitHub Pages?

GitHub Pages hosts **static** files only — it can't run the Python server that
the app needs to talk to Canvas, so the app can't be deployed to Pages as-is.
Local (or a VPS) is the intended way.

---

# Troubleshooting

| Problem | Fix |
|--------|-----|
| `git: command not found` | Install Git (see your OS section, Step 4/A). |
| `python3: command not found` | Install Python (see your OS section) and reopen the terminal. |
| `node: command not found` | Install Node.js and reopen the terminal. |
| "Local server is not responding" | You closed the terminal that runs `npm start`. Re-run it. |
| Port already in use | The app auto-tries ports 8000–8019. Open the next number, e.g. http://localhost:8001. |
| Browser shows a blank page | Reload. Check the terminal for error messages. |
| Connect button stuck on "Connecting…" | You had to reload last time — that's fixed now; if it still sticks, open DevTools console (Cmd+Option+J on Mac / F12 on Windows) and check for red errors. |
| Canvas says the token is invalid | Tokens expire if you set an expiry. Create a new one in Canvas → Account → Settings. |

# Updating to the newest version

If you cloned with Git:

```bash
cd canvas-pro
git pull
npm start        # (if not already running; Ctrl+C first if it is)
```

If you downloaded the ZIP, just re-download it and replace the folder.