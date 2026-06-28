import { existsSync, readFileSync } from "fs";
import os from "os";
import path from "path";

export function detectChromePath() {
    const p = process.platform;

    if (p === "linux") {
        const candidates = [
            "/usr/bin/google-chrome",
            "/usr/bin/google-chrome-stable",
            "/usr/bin/chromium-browser",
            "/usr/bin/chromium",
            "/snap/bin/chromium",
        ];
        return candidates.find(existsSync) ?? null;
    }

    if (p === "win32") {
        const local  = process.env.LOCALAPPDATA ?? "";
        const pf     = process.env["ProgramFiles"] ?? "C:\\Program Files";
        const pf86   = process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)";
        const candidates = [
            path.join(local, "Google", "Chrome", "Application", "chrome.exe"),
            path.join(pf,   "Google", "Chrome", "Application", "chrome.exe"),
            path.join(pf86, "Google", "Chrome", "Application", "chrome.exe"),
        ];
        return candidates.find(existsSync) ?? null;
    }

    if (p === "darwin") {
        const mac = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
        return existsSync(mac) ? mac : null;
    }

    return null;
}

export function detectChromeUserDataDir() {
    const p    = process.platform;
    const home = os.homedir();

    if (p === "linux") {
        const candidates = [
            path.join(home, ".config", "google-chrome"),
            path.join(home, ".config", "chromium"),
            path.join(home, ".config", "google-chrome-stable"),
            path.join(home, "snap", "chromium", "common", "chromium"),
        ];
        return candidates.find(existsSync) || path.join(home, ".config", "google-chrome");
    }
    if (p === "darwin") return path.join(home, "Library", "Application Support", "Google", "Chrome");
    if (p === "win32")  return path.join(process.env.LOCALAPPDATA ?? "", "Google", "Chrome", "User Data");

    return null;
}

// ─── Chrome profile finder ────────────────────────────────────────────────────
//
// Reads Chrome's "Local State" file which lists every profile directory with its
// display name and signed-in email. Returns the directory name (e.g. "Profile 1")
// that matches either the given name or email — ready for --profile-directory=.

export function findChromeProfile(userDataDir, { name, email } = {}) {
    if (!userDataDir || (!name && !email)) return null;

    const localState = path.join(userDataDir, "Local State");
    if (!existsSync(localState)) return null;

    try {
        const state = JSON.parse(readFileSync(localState, "utf8"));
        const cache = state?.profile?.info_cache;
        if (!cache || typeof cache !== "object") return null;

        for (const [dirName, info] of Object.entries(cache)) {
            const profileName  = (info.name       || "").toLowerCase();
            const profileEmail = (info.user_name  || "").toLowerCase();

            if (name  && profileName  === name.toLowerCase())  return dirName;
            if (email && profileEmail === email.toLowerCase()) return dirName;
            if (name  && dirName.toLowerCase() === name.toLowerCase()) return dirName;
        }
    } catch {
        // corrupted or unreadable Local State — fall through
    }

    return null;
}
