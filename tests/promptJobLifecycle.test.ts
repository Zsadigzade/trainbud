import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { APP_DB_SCHEMA, STALE_PROMPT_JOB_SECONDS, reconcileStalePromptJobs } from "../src/appDb.js";

// The reported symptom, again: "AI unavailable" on the watch.
//
// `reconcilePromptJobs` ran inside `getDb()`, so the FIRST time any process
// opened app.db it flipped every pending or running job to
//
//     error: "The server stopped before this answer came back."
//
// app.db is opened by every entry point. Ask a question on the watch, then run
// `trainbud doctor` -- or `status`, or `findings`, or a backfill -- while the
// answer is still in flight, and the CLI kills the server's live job from
// another process. The watch polls for thirty seconds, finds `error`, and draws
// the one screen this project has spent two sessions making more specific.
//
// Two halves, and both are needed. Reconciling only at serve startup stops a
// CLI command touching a server's table at all. The age floor is what protects
// a second server, or a restart racing an in-flight answer: nothing younger
// than the watch's own polling window can be legitimately reclaimed.

function db(): Database.Database {
  const database = new Database(":memory:");
  database.exec(APP_DB_SCHEMA);
  return database;
}

function insertJob(
  database: Database.Database,
  id: string,
  status: string,
  createdAt: number
): void {
  database
    .prepare(
      "INSERT INTO prompt_jobs (id, prompt, status, result, error, created_at, completed_at) VALUES (?, 'q', ?, NULL, NULL, ?, NULL)"
    )
    .run(id, status, createdAt);
}

function statusOf(database: Database.Database, id: string): string {
  return (
    database.prepare("SELECT status FROM prompt_jobs WHERE id = ?").get(id) as {
      status: string;
    }
  ).status;
}

describe("reclaiming prompt jobs", () => {
  it("leaves a job that is younger than the watch's own polling window", () => {
    const database = db();
    const now = 1_800_000_000;
    insertJob(database, "fresh", "running", now - 10);

    reconcileStalePromptJobs(database, now);

    assert.equal(
      statusOf(database, "fresh"),
      "running",
      "a ten-second-old job is a live answer, not wreckage"
    );
  });

  it("reclaims a job old enough that nothing can still be waiting on it", () => {
    const database = db();
    const now = 1_800_000_000;
    insertJob(database, "stale", "pending", now - STALE_PROMPT_JOB_SECONDS - 1);

    reconcileStalePromptJobs(database, now);

    assert.equal(statusOf(database, "stale"), "error");
  });

  it("never touches a job that already finished", () => {
    const database = db();
    const now = 1_800_000_000;
    insertJob(database, "done", "done", now - 100_000);

    reconcileStalePromptJobs(database, now);

    assert.equal(statusOf(database, "done"), "done");
  });

  it("gives the floor room for the watch's thirty-second poll", () => {
    // The watch polls a job id for about thirty seconds before giving up. A
    // floor at or below that could reclaim an answer someone is still waiting
    // for, which is the bug rather than the fix.
    assert.ok(
      STALE_PROMPT_JOB_SECONDS >= 60,
      `floor of ${STALE_PROMPT_JOB_SECONDS}s is inside the watch's polling window`
    );
  });
});
