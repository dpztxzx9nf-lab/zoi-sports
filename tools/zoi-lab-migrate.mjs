#!/usr/bin/env node
/* Applies a lab migration the way SQLite needs it applied: one statement at a
   time, with an ADD COLUMN skipped when the column is already there.

   SQLite has no "ADD COLUMN IF NOT EXISTS" - it is a syntax error - so a
   migration file containing a bare ALTER cannot guard itself. The guard lives
   here instead: pragma_table_info is read before each ALTER, and the ALTER only
   runs when the column is missing. That is what makes re-running a migration
   safe, and it is checked by applying 0008 twice in the parser's own tests.

   Everything else in a migration file is passed straight through, because the
   repo's other statements are already idempotent (CREATE ... IF NOT EXISTS).

   Usage:
     node tools/zoi-lab-migrate.mjs <file.sql> [<file.sql> ...]
       --probe        print the plan and change nothing
       --db <path>    apply to a local SQLite file instead of the remote D1

   The remote path shells out to wrangler statement by statement, which is why
   this is a script rather than one --file call. */
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

/* A migration is comments plus statements. The comment stripping is the same
   rule d1.mjs uses: a comment may contain a semicolon. */
export function statementsOf(sql) {
  const body = String(sql).replace(/--[^\n]*/g, " ");
  const out = [];
  let cur = "";
  let quote = false;
  for (const ch of body) {
    if (ch === "'") quote = !quote;
    if (ch === ";" && !quote) { if (cur.trim()) out.push(cur.trim()); cur = ""; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out.filter(Boolean);
}

const ADD_COLUMN = /^ALTER\s+TABLE\s+(\w+)\s+ADD\s+COLUMN\s+(\w+)\s+(.+)$/i;

/* Which statements in a migration still have work to do, given the columns a
   table already has. `columnsOf(table)` returns a Set, or null when the table
   does not exist yet - in which case an ALTER is deferred to the statement that
   creates it, and reported as such rather than run into an error. */
export function planFor(sql, columnsOf) {
  const plan = [];
  for (const statement of statementsOf(sql)) {
    const add = ADD_COLUMN.exec(statement);
    if (!add) { plan.push({ statement, skip: false, why: "not an ADD COLUMN" }); continue; }
    const [, table, column] = add;
    const have = columnsOf(table);
    if (have && have.has(column)) {
      plan.push({ statement, skip: true, why: table + "." + column + " already exists" });
    } else {
      plan.push({ statement, skip: false, why: table + "." + column + " is missing" });
    }
  }
  return plan;
}

/* --------------------------------------------------------------- running ---
   Kept apart from the planning above so the plan can be tested without a
   database, and the run can be pointed at either one. */

async function main(argv) {
  const args = argv.slice(2);
  const probe = args.includes("--probe");
  const dbAt = args.indexOf("--db");
  const dbPath = dbAt >= 0 ? args[dbAt + 1] : null;
  const files = args.filter((a, i) => !a.startsWith("--") && !(dbAt >= 0 && i === dbAt + 1));
  if (!files.length) {
    console.error("usage: node tools/zoi-lab-migrate.mjs <file.sql> [...] [--probe] [--db <path>]");
    process.exit(2);
  }

  let db = null;
  if (dbPath) {
    const { DatabaseSync } = await import("node:sqlite");
    db = new DatabaseSync(dbPath);
  }

  const columnsOf = (table) => {
    try {
      if (db) {
        const rows = db.prepare("SELECT name FROM pragma_table_info(?)").all(table);
        if (!rows.length) return null;
        return new Set(rows.map((r) => r.name));
      }
      const out = execFileSync("npx", ["--yes", "wrangler@3", "d1", "execute", "zoi-tryouts", "--remote", "--json",
        "--command", "SELECT name FROM pragma_table_info('" + table + "')"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
      const parsed = JSON.parse(out.slice(out.indexOf("[")));
      const rows = Array.isArray(parsed) ? (parsed[0] && parsed[0].results) || [] : [];
      if (!rows.length) return null;
      return new Set(rows.map((r) => r.name));
    } catch {
      return null;
    }
  };

  let ran = 0, skipped = 0;
  for (const file of files) {
    const sql = readFileSync(file, "utf8");
    for (const step of planFor(sql, columnsOf)) {
      const head = step.statement.replace(/\s+/g, " ").slice(0, 70);
      if (step.skip) { skipped++; console.log("  skip  " + head + "  (" + step.why + ")"); continue; }
      if (probe) { console.log("  would " + head); continue; }
      if (db) db.prepare(step.statement).run();
      else {
        execFileSync("npx", ["--yes", "wrangler@3", "d1", "execute", "zoi-tryouts", "--remote",
          "--command", step.statement], { stdio: "inherit" });
      }
      ran++;
      console.log("  ok    " + head);
    }
  }
  console.log((probe ? "plan: " : "") + ran + " applied, " + skipped + " skipped (already present)");
  if (db) db.close();
}

if (import.meta.url === "file://" + process.argv[1]) {
  main(process.argv).catch((e) => { console.error(e && e.message ? e.message : e); process.exit(1); });
}
