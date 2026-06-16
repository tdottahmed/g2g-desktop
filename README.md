# G2G Automation Desktop

A Windows desktop application that automates posting game account offers on [g2g.com](https://g2g.com). It connects to your live Laravel backend via API and drives a headless Chromium browser to submit offers — no manual browser interaction required.

---

## Table of Contents

- [Features](#features)
- [Architecture Overview](#architecture-overview)
- [Prerequisites](#prerequisites)
- [Development Setup](#development-setup)
- [Building for Windows](#building-for-windows)
- [Distributing & Auto-Update](#distributing--auto-update)
- [First-Run User Guide](#first-run-user-guide)
- [Settings Reference](#settings-reference)
- [Tray Menu](#tray-menu)
- [Project Structure](#project-structure)
- [Automation Scripts Reference](#automation-scripts-reference)
- [Troubleshooting](#troubleshooting)
- [Release Checklist](#release-checklist)

---

## Features

- **Run Once** — fetch all pending templates from the Laravel API and post them immediately
- **Watch Mode** — poll the API on a configurable interval and post automatically, continuously
- **Delete All Offers** — remove all live g2g.com listings for all configured accounts
- **System tray** — minimize to tray, right-click for quick actions
- **Close-to-tray** — closing the window hides it; use Tray → Quit to exit fully
- **Single-instance** — launching a second copy focuses the existing window
- **Auto-update** — checks GitHub Releases once per 24 h; download and install in-app
- **Start with Windows** — optional login item via Windows registry
- **First-run wizard** — guides new users through connection setup and Chromium installation
- **Live log panel** — colour-coded output (success / error / warn / info), FIFO-capped at 500 lines
- **Desktop notifications** — run complete, auth failure, API error, Playwright not installed

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────┐
│                   Electron App                       │
│                                                      │
│  ┌──────────────┐    IPC     ┌──────────────────┐   │
│  │   Renderer   │◄──────────►│   Main Process   │   │
│  │  (HTML/JS)   │            │  (Node.js/CJS)   │   │
│  └──────────────┘            └────────┬─────────┘   │
│                                       │ spawn        │
│                              ┌────────▼─────────┐   │
│                              │  runner.js (ESM)  │   │
│                              │  Playwright +     │   │
│                              │  Laravel API      │   │
│                              └───────────────────┘   │
└─────────────────────────────────────────────────────┘
                                       │ HTTP
                         ┌─────────────▼────────────┐
                         │   Laravel Backend (live)  │
                         │   /api/automation/*       │
                         └──────────────────────────┘
```

The Electron main process (CJS) spawns `runner.js` (ESM) as a child process using `ELECTRON_RUN_AS_NODE=1` on the Electron binary when packaged. The automation scripts live in `resources/automation/` after build.

---

## Prerequisites

### For development (Linux / macOS / Windows)

| Requirement | Version |
|---|---|
| Node.js | 18 LTS or later |
| npm | 9+ |
| Git | any |

### For building Windows installer

Building the NSIS `.exe` installer requires Wine on Linux/macOS, or running natively on Windows. The easiest approach is to build directly on a Windows machine or a Windows CI runner.

---

## Development Setup

```bash
# 1. Clone the desktop app repo
git clone https://github.com/GITHUB_OWNER/g2g-automation-desktop.git
cd g2g-automation-desktop

# 2. Install dependencies
npm install

# 3. Copy your automation scripts into the automation/ folder
#    (scripts from the Laravel project's scripts/automation/ directory)
cp -r /path/to/laravel/scripts/automation/* automation/

# 4. Install Chromium (needed in dev to run without the setup screen)
npm run install:browsers

# 5. Start in dev mode
npm start
```

> **Linux note:** If you see GPU errors, run `npm start -- --no-sandbox --disable-gpu`. This is a Linux sandbox issue that does not affect Windows production builds.

---

## Building for Windows

```bash
# Build both NSIS installer + portable .exe
npm run build:win

# Build unpacked directory only (fast, no installer — good for testing)
npm run build:dir

# Outputs land in dist/
# - "G2G Automation Setup 1.0.0.exe"   (NSIS installer)
# - "G2G Automation Portable 1.0.0.exe" (single-file portable)
```

### What the build does

1. Runs `scripts/build-icon.js` to generate `assets/icon.ico` (pure Node.js, no external deps)
2. Bundles `src/`, `assets/`, `node_modules/` into `dist/`
3. Copies `automation/` into `resources/automation/` (excludes `cookies/` and `.env`)
4. `asar: false` — required so child processes can `require()` modules from the bundle

### Icon generation

The icon is generated programmatically from brand colour `#2563eb` (blue). Sizes: 16, 32, 48, 256 px.

```bash
npm run icon   # regenerate assets/icon.ico
```

---

## Distributing & Auto-Update

The app uses **electron-updater** with GitHub Releases as the update provider.

### Setup (one time)

1. Create a GitHub repository named `g2g-automation-desktop`
2. In `package.json` → `build.publish`, replace `GITHUB_OWNER` with your actual GitHub username/org:
   ```json
   "publish": {
     "provider": "github",
     "owner": "your-github-username",
     "repo": "g2g-automation-desktop",
     "releaseType": "release"
   }
   ```
3. Also update the placeholder in `src/main/ipc-handlers.js` and `src/main/tray.js` (search for `GITHUB_OWNER`)
4. Create a GitHub Personal Access Token with `repo` scope
5. Set `GH_TOKEN=your-token` in your environment before publishing

### Publishing a new release

```bash
# Bump version in package.json first
npm version patch   # or minor / major

# Build and publish to GitHub Releases
GH_TOKEN=your-token npm run build:win -- --publish always
```

This uploads the installer, portable exe, and `latest.yml` to a new GitHub Release. The running app checks for updates automatically once per 24 hours and shows a banner when an update is available.

### Update flow (end user)

1. App starts → checks GitHub Releases after 5 seconds
2. If update found → blue banner appears at the top of the dashboard
3. User clicks **Download** → progress shown in banner
4. After download: **Install & Restart** button → installs silently and restarts

---

## First-Run User Guide

### Step 1 — Install Chromium (packaged app only)

On first launch after installing, the app shows a **Setup** screen that downloads Chromium (~150 MB). This is stored in the app's user data directory and is never mixed with a system Chrome installation.

Progress is shown in real time. Click **Retry** if the download fails.

### Step 2 — Connect to your Laravel server

After Chromium is installed, the **Settings** screen opens automatically.

Fill in:
- **Laravel API URL** — the base URL of your hosted Laravel app, e.g. `https://yourapp.com`
- **API Key** — the value of `API_AUTOMATION_KEY` from your Laravel `.env` file

Click **Test Connection**. A green success message confirms the app can reach the API. Click **Go to Dashboard**.

### Step 3 — Post offers

From the **Dashboard**:

| Button | What it does |
|---|---|
| **Run Once** | Fetches all pending templates now and posts them |
| **Start Watch** | Starts continuous polling (interval configured in Settings) |
| **Stop Watch / Stop** | Cancels the current operation |
| **Delete All Offers** | Deletes all live g2g.com offers for all accounts |

Log output appears in real time. Colour coding:
- Green — success
- Red — error / failure
- Amber — warning
- Blue — info
- Purple — app-level messages

---

## Settings Reference

| Setting | Default | Description |
|---|---|---|
| Laravel API URL | — | Base URL of your Laravel deployment |
| API Key | — | Value of `API_AUTOMATION_KEY` in Laravel `.env` |
| Watch Interval | 60 s | Polling frequency in watch mode |
| SlowMo | 120 ms | Delay between Playwright actions (100–200 ms recommended) |
| Headless Mode | on | Run Chromium invisibly. Turn off for debugging |
| Start with Windows | off | Open the app automatically at Windows login |

---

## Tray Menu

Right-click the tray icon for quick actions:

- **G2G Automation vX.Y.Z** — version info (disabled, display only)
- **Open Dashboard** — bring the window to focus
- **Run Once** — start a single run
- **Start Watch / Stop Watch** — toggle watch mode
- **Stop** — stop any running operation
- **Check for Updates / Install Update** — update management
- **Quit** — fully exit the application

Left-click or double-click the tray icon to open the dashboard.

---

## Project Structure

```
g2g-automation-desktop/
├── assets/
│   └── icon.ico                # Generated by scripts/build-icon.js
├── automation/                 # Automation scripts (copied from Laravel project)
│   ├── package.json            # { "type": "module" } — ESM
│   ├── runner.js               # Main entry point (API-driven)
│   ├── delete-offers.js        # Delete all offers entry point
│   ├── api-client.js           # Laravel API client
│   └── utils/
│       ├── auth.js
│       ├── form-filler.js
│       ├── sell.js
│       └── index.js
├── scripts/
│   └── build-icon.js           # Programmatic ICO generator
├── src/
│   ├── main/
│   │   ├── index.js            # App entry, window creation, lifecycle
│   │   ├── ipc-handlers.js     # All IPC handlers + log parser
│   │   ├── config-store.js     # electron-store v8 settings wrapper
│   │   ├── runner-manager.js   # Child process spawn/stop
│   │   ├── tray.js             # System tray + context menu
│   │   ├── notifications.js    # Native desktop notifications
│   │   ├── setup.js            # First-run Chromium installer
│   │   ├── updater.js          # Auto-update (electron-updater)
│   │   └── icon-generator.js   # Runtime status icons (PNG buffers)
│   └── renderer/
│       ├── preload.js          # contextBridge API surface
│       ├── dashboard.html/js   # Main UI
│       ├── settings.html/js    # Settings UI
│       └── setup.html/js       # First-run browser install UI
├── package.json
└── README.md
```

---

## Automation Scripts Reference

The `automation/` folder contains the Node.js/Playwright scripts. These run as a separate process spawned by the Electron main process.

### `runner.js`

```bash
node runner.js              # run once
node runner.js --watch      # poll continuously
node runner.js --status     # connectivity/auth check only
```

**Environment variables** (set automatically by the app, or via `automation/.env` in dev):

| Variable | Description |
|---|---|
| `LARAVEL_API_URL` | Base URL of Laravel app |
| `API_KEY` | API automation key |
| `HEADLESS` | `true` / `false` — Chromium headless mode |
| `SLOW_MO` | Milliseconds between Playwright actions |
| `WATCH_INTERVAL_SECONDS` | Polling interval for `--watch` mode |
| `COOKIES_DIR` | Directory for per-account cookie files |
| `PLAYWRIGHT_BROWSERS_PATH` | Where Chromium is installed |

### `delete-offers.js`

```bash
node delete-offers.js --api         # delete via API-driven mode
node delete-offers.js --api --watch # delete continuously
```

### Cookie files

Cookie files are stored in the app's user data directory under `cookies/`. They are created automatically on first successful login and reused on subsequent runs. They are excluded from the installer package.

---

## Troubleshooting

### "Chromium not found" / setup screen loops

Delete the browsers directory and reinstall:

1. Open the app, go to **Setup** screen
2. Click **Retry** — or manually delete `%APPDATA%\g2g-automation\browsers\` and relaunch

### API connection fails

- Verify the **Laravel API URL** has no trailing slash and is reachable from your network
- Check `API_AUTOMATION_KEY` in Laravel `.env` matches the **API Key** in Settings
- Ensure the Laravel queue worker is running (`php artisan queue:listen`)
- Check that the `X-Api-Key` header is allowed by your server's CORS/firewall rules

### Playwright browser crashes

- Increase **SlowMo** to 200 ms or higher in Settings
- Disable **Headless Mode** temporarily to watch what the browser is doing
- Check the log panel for "Authentication failed" — g2g.com may have changed its login flow

### App won't start / white screen

- Check `%APPDATA%\g2g-automation\logs\` for `main.log`
- Try the portable `.exe` instead of the installer version
- Ensure you're on Windows 10 64-bit or later

### Update banner does not appear

- Auto-update only works in the packaged (installed/portable) app, not in dev mode
- The `publish.owner` in `package.json` must be set to the actual GitHub owner
- A valid GitHub Release with `latest.yml` must exist

---

## Release Checklist

Before publishing a new release:

- [ ] Bump `version` in `package.json` (`npm version patch/minor/major`)
- [ ] Update `GITHUB_OWNER` placeholder if it hasn't been replaced yet
- [ ] Run `npm run build:win` locally and test the installer
- [ ] Test the installer on a clean Windows machine (no dev tools)
- [ ] Verify auto-update works from the previous version
- [ ] Tag the release: `git tag v1.x.x && git push --tags`
- [ ] Publish: `GH_TOKEN=... npm run build:win -- --publish always`
- [ ] Check that `latest.yml` was uploaded to the GitHub Release
