/* zoi-cues - the headshot count for one replay, from the cue reader beside it.

   Why this is a separate process
   -----------------------------
   The headshot signal is not in any event a replay stores in the clear. It lives
   in the compressed network stream: the game batches its damage cues into
   NetMulticast_Athena_BatchedDamageCues RPCs, and each cue says whether the hit
   was critical and which actor it landed on. Reading that means decompressing
   and walking the stream packet by packet. tools/zoi-replay.mjs reads only the
   encrypted event chunks and deliberately does not grow a decompressor;
   tools/zoi-cues/ is a small .NET program that does that one job and prints one
   line of JSON. This module is the seam: find it, run it, read the number.

   What it will not do
   -------------------
   Throw, hang, or invent a count. Every failure - no .NET on the machine, no
   build in dist/, a replay the reader cannot parse, a process that never
   finishes - comes back as { ok: false, reason }. The one thing that is never
   done is turning a failure into 0: a match where the player hit nobody in the
   head is { ok: true, headshots: 0 }, and the two must stay distinguishable all
   the way to the page. That is the whole reason the reason string travels beside
   the number.

   The rule itself is NOT here. The CLI applies it - local player only, critical
   true, a named victim - and prints the result. Re-implementing it on this side
   would be a second copy of a settled rule that could drift from the first. */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));

/* The committed win-x64 build. Committed on purpose: the machine this runs on
   has the .NET runtime but no compiler and no reason to get one. */
export const CUE_DLL = path.join(HERE, "zoi-cues", "dist", "zoi-cues.dll");

/* The reason the lab stores when there is no reader at all. Distinct from a
   reader that ran and failed, because the fix is different: install or redeploy
   versus look at the file. */
export const CUE_MISSING_REASON = "the cue reader is not installed";

/* Sixty seconds. The reader takes about two seconds on a full match, so this is
   not a tight budget - it is the line between slow and wedged. A replay the
   game was still writing can block a decompressor indefinitely, and this runs
   inside a poll loop beside a live game. */
export const CUE_TIMEOUT_MS = 60_000;

/* Where dotnet lives, in the order worth trying.
   PATH first, because that is how it is normally installed and it is what the
   person who built this used. Then the machine-wide install path, which is where
   the Windows installer puts it and which is NOT always on the PATH of a process
   started from a logon script - the path this agent actually runs under. Then
   DOTNET_ROOT, which is what a per-user or side-by-side install sets. */
export function dotnetCandidates(env = process.env) {
  const out = [];
  if (env.DOTNET_ROOT) out.push(path.join(env.DOTNET_ROOT, "dotnet.exe"), path.join(env.DOTNET_ROOT, "dotnet"));
  out.push("C:\\Program Files\\dotnet\\dotnet.exe");
  out.push("dotnet");
  return out;
}

/* The dotnet to run, or null.
   A bare "dotnet" is never checked with existsSync - that would look for a file
   called dotnet in the working directory and say no on a machine where it is
   perfectly well installed. It is returned as the last resort and left to the
   spawn to fail, which is the only honest test of whether it is on PATH. */
export function findDotnet(env = process.env) {
  const candidates = dotnetCandidates(env);
  for (const candidate of candidates) {
    if (!path.isAbsolute(candidate)) continue;
    if (existsSync(candidate)) return candidate;
  }
  return candidates[candidates.length - 1] || "dotnet";
}

/* Is the reader actually there? Checked once per run, not once per match: the
   answer cannot change while the agent is up, and a per-match stat() on a
   network path is exactly the kind of thing that turns a fast poll into a slow
   one. */
export function cueReaderInstalled() {
  return existsSync(CUE_DLL);
}

/* Read one replay's headshot count.

   Resolves - never rejects - to one of:
     { ok: true,  headshots: 8, cues: 167, crit: 11, critNamed: 8, localPlayer: "..." }
     { ok: false, reason: "..." }

   `opts` exists for the harness: a shorter timeout, or a stand-in for dotnet
   that hangs, which is the only honest way to test the timeout without waiting
   a real minute. Nothing in the agent passes it. */
export function readHeadshots(replayPath, opts = {}) {
  const dll = opts.dll || CUE_DLL;
  const timeoutMs = Number.isFinite(opts.timeoutMs) ? opts.timeoutMs : CUE_TIMEOUT_MS;
  const dotnet = opts.dotnet || findDotnet(opts.env || process.env);

  if (!existsSync(dll)) return Promise.resolve(missing());
  if (typeof replayPath !== "string" || !replayPath) {
    return Promise.resolve({ ok: false, reason: "no replay path was given to the cue reader" });
  }

  return new Promise((resolve) => {
    let settled = false;
    let stdout = "";
    let stderr = "";
    let child;

    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };

    /* The timer is not decoration. A decompressor reading a file the game is
       still appending to can sit in a read for as long as the handle stays open,
       and this call is inside a loop that must reach the settings send. */
    const timer = setTimeout(() => {
      /* Kill, then close the pipes by hand. The kill alone stops the child but
         leaves its stdout handle open, and an open handle is an event loop that
         will not exit - the agent would stay up with a dead reader attached to
         it. Windows gets taskkill because a .NET host can leave a child of its
         own behind, and killing only the parent would orphan that one. */
      try {
        if (process.platform === "win32" && child?.pid) {
          spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
        } else {
          child?.kill("SIGKILL");
        }
      } catch { /* already gone */ }
      try { child?.stdout?.destroy(); child?.stderr?.destroy(); } catch { /* nothing to close */ }
      finish({ ok: false, reason: "the cue reader did not finish within " + Math.round(timeoutMs / 1000) + " seconds" });
    }, timeoutMs);
    if (typeof timer.unref === "function") timer.unref();

    try {
      child = spawn(dotnet, [dll, replayPath], {
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (e) {
      finish(missingIfSpawnFailed(e));
      return;
    }

    child.on("error", (e) => finish(missingIfSpawnFailed(e)));
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk) => { stdout += chunk; });
    child.stderr?.on("data", (chunk) => { stderr += chunk; });

    child.on("close", (code) => {
      if (settled) return;
      const parsed = parseCueLine(stdout);
      if (parsed && parsed.ok === true) {
        /* A non-zero exit with a valid success line is a contradiction, and the
           line is the measurement: the reader writes its answer and returns 0,
           so this cannot happen unless something else went wrong. Treat the
           exit code as noise rather than throwing the number away. */
        finish(parsed);
        return;
      }
      if (parsed && parsed.ok === false) {
        finish({ ok: false, reason: typeof parsed.reason === "string" && parsed.reason ? parsed.reason : "the cue reader could not read the replay" });
        return;
      }
      /* No usable line. The reader prints one line or nothing, so nothing here
         means it died before it could answer - a missing runtime, a missing
         dependency beside the dll, a crash. Say which, with the exit code, and
         take the first line of stderr because that is where the runtime says
         why. */
      const detail = firstLine(stderr);
      finish({
        ok: false,
        reason: "the cue reader failed" +
          (code === null ? " (it was killed)" : " (exit " + code + ")") +
          (detail ? ": " + detail : ""),
      });
    });
  });
}

/* The last non-empty line of stdout that parses as JSON with an `ok` field.
   Last rather than first: the .NET runtime can print a host banner, and a
   success line that arrives after it is still the answer. */
export function parseCueLine(text) {
  if (typeof text !== "string" || !text) return null;
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    let value;
    try { value = JSON.parse(lines[i]); } catch { continue; }
    if (!value || typeof value !== "object" || typeof value.ok !== "boolean") continue;
    if (value.ok === true) {
      /* A success line without a count is not a success; without this the row
         would carry undefined and serialise as a row with no field at all. */
      if (!Number.isFinite(value.headshots)) return { ok: false, reason: "the cue reader answered without a headshot count" };
      const n = Math.max(0, Math.round(value.headshots));
      return {
        ok: true,
        headshots: n,
        cues: Number.isFinite(value.cues) ? value.cues : null,
        crit: Number.isFinite(value.crit) ? value.crit : null,
        critNamed: Number.isFinite(value.critNamed) ? value.critNamed : null,
        localPlayer: typeof value.localPlayer === "string" ? value.localPlayer : null,
      };
    }
    return { ok: false, reason: typeof value.reason === "string" && value.reason ? value.reason : "the cue reader could not read the replay" };
  }
  return null;
}

const missing = () => ({ ok: false, reason: CUE_MISSING_REASON });

/* ENOENT is the honest "there is no .NET on this machine", which is the same
   situation as no reader at all and should read the same way. Anything else -
   permissions, a corrupt exe - is its own reason. */
function missingIfSpawnFailed(e) {
  if (e && e.code === "ENOENT") return missing();
  return { ok: false, reason: "the cue reader could not be started (" + (e && e.message ? e.message : e) + ")" };
}

function firstLine(text) {
  if (typeof text !== "string") return "";
  const line = text.split(/\r?\n/).map((l) => l.trim()).find(Boolean);
  if (!line) return "";
  return line.length <= 160 ? line : line.slice(0, 160);
}
