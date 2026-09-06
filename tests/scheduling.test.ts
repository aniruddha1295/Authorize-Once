import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const CRON_PATH = path.join(process.cwd(), "scheduling", "contribution-scheduler.crontab");
const PACKAGE_PATH = path.join(process.cwd(), "package.json");

// A valid 5-field POSIX cron line: <min> <hour> <dom> <month> <dow>
const CRON_FIELD_COUNT = /^\s*(?:\*|[0-9-/,]+)\s+(?:\*|[0-9-/,]+)\s+(?:\*|[0-9-/,]+)\s+(?:\*|[0-9-/,]+)\s+(?:\*|[0-9-/,]+)/;

describe("P9-6 — a real scheduled execution path exists in the repository", () => {
  it("ships a committed crontab that runs the recurring contribution job", () => {
    const cron = readFileSync(CRON_PATH, "utf8");
    expect(cron).toContain("scheduler");
    expect(cron).toContain("weekly");
  });

  it("the crontab invokes the actual scheduled entry point (`run-scheduler.ts`)", () => {
    const cron = readFileSync(CRON_PATH, "utf8");
    expect(cron).toContain("scripts/run-scheduler.ts");
  });

  it("the crontab contains at least one valid 5-field cron line", () => {
    const cron = readFileSync(CRON_PATH, "utf8");
    const jobLines = cron
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#"));
    expect(jobLines.length).toBeGreaterThan(0);
    for (const line of jobLines) {
      expect(line).toMatch(CRON_FIELD_COUNT);
    }
    // weekly: runs on day-of-week 1 (Monday)
    expect(jobLines.join(" ")).toMatch(/\s1\s/);
  });

  it("the deterministic/manual trigger is wired as an npm script", () => {
    const pkg = JSON.parse(readFileSync(PACKAGE_PATH, "utf8")) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts["run-scheduler"]).toContain("run-scheduler.ts");
  });
});