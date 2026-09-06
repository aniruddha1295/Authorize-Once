import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createCircleStore } from "@/lib/store";

const dirs: string[] = [];
const WALLET = "0x" + "cd".repeat(20);
const GRANTED = "2026-09-01T00:00:00.000Z";
const NOW = "2026-09-05T12:00:00.000Z";
const PERIOD = "2026-W36";

afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  dirs.length = 0;
});

function tempDbPath(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "rtd-p9-store-"));
  dirs.push(dir);
  return path.join(dir, "circle.db");
}

describe("P9-4/P9-6/P9-8 — durable, reload-proof storage", () => {
  it("authorization expiry and the exact TTL are durably computed and recorded (P9-4)", () => {
    const dbPath = tempDbPath();
    const store = createCircleStore(dbPath);
    store.ensureMember("user-1", WALLET, GRANTED);
    const auth = store.setAuthorization("user-1", WALLET, "ethereum", 7_776_000, GRANTED);
    expect(auth.expiresAt).toBe(new Date(new Date(GRANTED).getTime() + 7_776_000 * 1000).toISOString());
    expect(store.isAuthorizationActive("user-1", NOW)).toBe(true);
    store.close();

    const reopened = createCircleStore(dbPath);
    expect(reopened.getAuthorization("user-1")?.status).toBe("active");
    expect(reopened.isAuthorizationActive("user-1", "2027-01-01T00:00:00.000Z")).toBe(false);
    reopened.close();
  });

  it("a failed contribution with a rejection reason survives a full reopen (P9-8)", () => {
    const dbPath = tempDbPath();
    const store = createCircleStore(dbPath);
    store.ensureMember("user-1", WALLET, GRANTED);
    store.claimContribution("user-1", PERIOD, NOW);
    store.markFailed("user-1", PERIOD, "rejected_by_policy", NOW);
    expect(store.getContribution("user-1", PERIOD)?.status).toBe("failed");
    store.close();

    const reopened = createCircleStore(dbPath);
    const record = reopened.getContribution("user-1", PERIOD);
    expect(record?.status).toBe("failed");
    expect(record?.reason).toBe("rejected_by_policy");
    reopened.close();
  });

  it("the member+period UNIQUE constraint wins races: a second claim sees the first (P9-6)", () => {
    const dbPath = tempDbPath();
    const a = createCircleStore(dbPath);
    a.ensureMember("user-1", WALLET, GRANTED);
    a.close();

    // two "processes" open the same db concurrently
    const first = createCircleStore(dbPath);
    const second = createCircleStore(dbPath);
    first.claimContribution("user-1", PERIOD, NOW);
    const race = second.claimContribution("user-1", PERIOD, NOW);
    expect(race.claimed).toBe(false);
    expect(race.existed).toBe(true);
    expect(race.record?.status).toBe("claimed");
    // a re-run never sends twice: the second process must see an existing outcome
    expect(second.getContribution("user-1", PERIOD)?.status).toBe("claimed");
    first.close();
    second.close();
  });
});