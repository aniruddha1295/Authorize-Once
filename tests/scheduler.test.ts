import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Address } from "viem";
import type { ContributionReceipt, ContributionSigner } from "@/lib/contributor";
import { classifyContributionError, ContributionRejectedError } from "@/lib/contributor";
import { runContributionRound } from "@/lib/scheduler";
import { createCircleStore, type CircleStore } from "@/lib/store";

const dirs: string[] = [];
const stores: CircleStore[] = [];

function trackStore(store: CircleStore): CircleStore {
  stores.push(store);
  return store;
}

function tempStore(): CircleStore {
  const dir = mkdtempSync(path.join(tmpdir(), "rtd-p9-scheduler-"));
  dirs.push(dir);
  return trackStore(createCircleStore(path.join(dir, "circle.db")));
}

function walletOf(memberId: string): Address {
  // deterministic, distinct, structurally valid addresses
  return ("0x" + memberId.slice(-40)) as Address;
}

const TO = ("0x" + "ab".repeat(20)) as Address;
const NOW = "2026-09-05T12:00:00.000Z";
const PERIOD = "2026-W36";

const GRANTED = "2026-09-01T00:00:00.000Z";

function activeMember(store: CircleStore, memberId: string): void {
  store.ensureMember(memberId, walletOf(memberId), GRANTED);
  store.setAuthorization(memberId, walletOf(memberId), "ethereum", 7776000, GRANTED);
}

function makeSigner(impl: (walletAddress: string) => ContributionReceipt | Error): {
  signer: ContributionSigner;
  calls: Array<{ walletAddress: string; to: Address; valueWei: bigint }>;
} {
  const calls: Array<{ walletAddress: string; to: Address; valueWei: bigint }> = [];
  const submit = vi.fn(async (tx: { walletAddress: Address; to: Address; valueWei: bigint }) => {
    calls.push(tx);
    const result = impl(tx.walletAddress);
    if (result instanceof Error) throw result;
    return result;
  });
  return { signer: { submitContribution: submit }, calls };
}

afterEach(() => {
  for (const store of stores) {
    try {
      store.close();
    } catch {
      // already closed by the test
    }
  }
  stores.length = 0;
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  dirs.length = 0;
});

describe("P9-4/P9-6/P9-8 — scheduled weekly round", () => {
  it("contributes for every active membership in the period", async () => {
    const store = tempStore();
    activeMember(store, "m1");
    activeMember(store, "m2");
    const { signer, calls } = makeSigner(() => ({
      hash: "0x" + "cd".repeat(32),
      caip2: "eip155:84532",
    }));

    const outcome = await runContributionRound({
      store,
      signer,
      to: TO,
      valueWei: 10_000_000_000_000_000n,
      now: new Date(NOW),
      period: PERIOD,
    });

    expect(outcome.period).toBe(PERIOD);
    expect(outcome.processed).toBe(2);
    expect(calls).toHaveLength(2);
    for (const call of calls) {
      expect(call.to).toBe(TO);
      expect(call.valueWei).toBe(10_000_000_000_000_000n);
    }
    expect(store.getContribution("m1", PERIOD)?.status).toBe("contributed");
    expect(store.getContribution("m2", PERIOD)?.status).toBe("contributed");
  });

  it("skips revoked and expired members with a recorded reason (P9-4/P9-7)", async () => {
    const store = tempStore();
    activeMember(store, "m1"); // active
    store.ensureMember("m2", walletOf("m2"), GRANTED);
    store.setAuthorization("m2", walletOf("m2"), "ethereum", 7776000, GRANTED);
    store.revokeAuthorization("m2", "2026-09-02T00:00:00.000Z"); // revoked
    store.ensureMember("m3", walletOf("m3"), GRANTED);
    store.setAuthorization("m3", walletOf("m3"), "ethereum", 1, GRANTED); // expired by now

    const { signer, calls } = makeSigner(() => ({
      hash: "0x" + "cd".repeat(32),
      caip2: "eip155:84532",
    }));

    const outcome = await runContributionRound({
      store,
      signer,
      to: TO,
      valueWei: 10_000_000_000_000_000n,
      now: new Date(NOW),
      period: PERIOD,
    });

    expect(calls).toHaveLength(1);
    const m2 = store.getContribution("m2", PERIOD);
    const m3 = store.getContribution("m3", PERIOD);
    expect(m2?.status).toBe("skipped");
    expect(m2?.reason).toBe("authorization_revoked");
    expect(m3?.status).toBe("skipped");
    expect(m3?.reason).toBe("authorization_expired");
    expect(outcome.skipped).toBe(2);
    expect(outcome.contributed).toBe(1);
  });

  it("a failing member does not stop other members (P9-8)", async () => {
    const store = tempStore();
    activeMember(store, "m-good");
    activeMember(store, "m-bad");
    activeMember(store, "m-also-good");

    const { signer, calls } = makeSigner((walletAddress) =>
      walletAddress === walletOf("m-bad")
        ? new Error("insufficient funds")
        : { hash: "0x" + "cd".repeat(32), caip2: "eip155:84532" },
    );

    const outcome = await runContributionRound({
      store,
      signer,
      to: TO,
      valueWei: 10_000_000_000_000_000n,
      now: new Date(NOW),
      period: PERIOD,
    });

    expect(calls.map((c) => c.walletAddress)).toEqual([
      walletOf("m-good"),
      walletOf("m-bad"),
      walletOf("m-also-good"),
    ]);
    expect(outcome.failed).toBe(1);
    expect(outcome.contributed).toBe(2);
    expect(store.getContribution("m-bad", PERIOD)?.status).toBe("failed");
    expect(store.getContribution("m-bad", PERIOD)?.reason).toBe("insufficient funds");
  });

  it("a policy DENY is recorded as a durable rejected_by_policy outcome (P9-8) without stopping the run", async () => {
    const store = tempStore();
    activeMember(store, "m-allowed");
    activeMember(store, "m-denied");

    const { signer } = makeSigner((walletAddress) =>
      walletAddress === walletOf("m-denied")
        ? new Error("DENY: eth_sendTransaction to 0x.. is not covered by policy")
        : { hash: "0x" + "cd".repeat(32), caip2: "eip155:84532" },
    );

    const outcome = await runContributionRound({
      store,
      signer,
      to: TO,
      valueWei: 10_000_000_000_000_000n,
      now: new Date(NOW),
      period: PERIOD,
    });

    const denied = store.getContribution("m-denied", PERIOD);
    expect(denied?.status).toBe("failed");
    expect(denied?.reason).toBe("rejected_by_policy");
    expect(outcome.failed).toBe(1);
    expect(outcome.contributed).toBe(1);
    expect(store.getContribution("m-allowed", PERIOD)?.status).toBe("contributed");
  });

  it("a re-run of the same period never submits again (durable idempotency, P9-6)", async () => {
    const store = tempStore();
    activeMember(store, "m1");
    activeMember(store, "m2");
    store.ensureMember("m3", walletOf("m3"), GRANTED);
    store.setAuthorization("m3", walletOf("m3"), "ethereum", 7776000, GRANTED);
    store.revokeAuthorization("m3", "2026-09-02T00:00:00.000Z");

    const { signer, calls } = makeSigner(() => ({
      hash: "0x" + "cd".repeat(32),
      caip2: "eip155:84532",
    }));

    await runContributionRound({
      store, signer, to: TO, valueWei: 10_000_000_000_000_000n,
      now: new Date(NOW), period: PERIOD,
    });
    const firstCalls = calls.length;
    expect(firstCalls).toBe(2);

    const second = await runContributionRound({
      store, signer, to: TO, valueWei: 10_000_000_000_000_000n,
      now: new Date(NOW), period: PERIOD,
    });

    // nothing new was submitted; existing durable outcomes are returned as-is
    expect(calls.length).toBe(firstCalls);
    expect(second.contributed).toBe(2);
    expect(second.skipped).toBe(1);
    expect(second.processed).toBe(3);
  });

  it("next period is a fresh, independent claim (same member is asked again)", async () => {
    const store = tempStore();
    activeMember(store, "m1");
    const { signer, calls } = makeSigner(() => ({
      hash: "0x" + "cd".repeat(32),
      caip2: "eip155:84532",
    }));

    await runContributionRound({
      store, signer, to: TO, valueWei: 10_000_000_000_000_000n,
      now: new Date(NOW), period: PERIOD,
    });
    await runContributionRound({
      store, signer, to: TO, valueWei: 10_000_000_000_000_000n,
      now: new Date("2026-09-12T12:00:00.000Z"), period: "2026-W37",
    });

    expect(calls).toHaveLength(2);
    expect(store.getContributions("m1").map((c) => c.period)).toEqual(["2026-W37", PERIOD]);
  });

  it("resumes safely after a restart mid-run (claimed row found, nothing re-sent)", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "rtd-p9-scheduler-"));
    dirs.push(dir);
    const dbPath = path.join(dir, "circle.db");
    const first = createCircleStore(dbPath);
    activeMember(first, "m1");
    first.close();

    // simulate a crash AFTER claim but BEFORE submit: the row is 'claimed'
    let fresh = createCircleStore(dbPath);
    fresh.claimContribution("m1", PERIOD, NOW);
    fresh.close();

    // a new process run finds the claimed row and must not send again
    fresh = createCircleStore(dbPath);
    const { signer, calls } = makeSigner(() => ({
      hash: "0x" + "cd".repeat(32),
      caip2: "eip155:84532",
    }));
    const outcome = await runContributionRound({
      store: fresh,
      signer,
      to: TO,
      valueWei: 10_000_000_000_000_000n,
      now: new Date(NOW),
      period: PERIOD,
    });
    expect(calls).toHaveLength(0);
    expect(outcome.skipped).toBe(1);
    expect(fresh.getContribution("m1", PERIOD)?.status).toBe("skipped");
    expect(fresh.getContribution("m1", PERIOD)?.reason).toBe("existing_outcome_claimed");
    fresh.close();
  });
});

describe("P9-8 — rejection classification", () => {
  it("maps Wallet API denial errors to the stable rejected_by_policy reason", () => {
    expect(classifyContributionError(new ContributionRejectedError("denied"))).toBe("rejected_by_policy");
    expect(classifyContributionError(new Error("POLICY DENY: method eth_sendTransaction"))).toBe(
      "rejected_by_policy",
    );
    expect(classifyContributionError(new Error("request rejected by the wallet"))).toBe(
      "rejected_by_policy",
    );
  });

  it("keeps the original message for non-policy failures", () => {
    expect(classifyContributionError(new Error("RPC timeout"))).toBe("RPC timeout");
    expect(classifyContributionError("gateway down")).toBe("gateway down");
    expect(classifyContributionError(undefined)).toBe("unknown_error");
  });
});