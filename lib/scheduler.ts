import type { Address } from "viem";
import { classifyContributionError, type ContributionSigner } from "./contributor";
import { currentPeriod } from "./periods";
import type { CircleStore, ContributionReason, ContributionStatus, Membership } from "./store";

export type RoundMemberStatus = "contributed" | "skipped" | "failed";

export interface RoundMemberResult {
  memberId: string;
  status: RoundMemberStatus;
  reason?: string;
  txHash?: string;
}

export interface RoundOutcome {
  period: string;
  processed: number;
  contributed: number;
  skipped: number;
  failed: number;
  results: RoundMemberResult[];
}

export interface RoundOptions {
  store: CircleStore;
  signer: ContributionSigner;
  to: Address;
  valueWei: bigint;
  now?: Date;
  period?: string;
}

function existingReason(status: ContributionStatus): ContributionReason {
  return `existing_outcome_${status}`;
}

async function processMember(opts: {
  membership: Membership;
  store: CircleStore;
  signer: ContributionSigner;
  to: Address;
  valueWei: bigint;
  period: string;
  nowIso: string;
}): Promise<RoundMemberResult> {
  const { membership, store, signer, to, valueWei, period, nowIso } = opts;
  const { member, authorization } = membership;
  const memberId = member.memberId;

  // P9-7/P9-4: revoked or expired authorizations are skipped, recorded and
  // never sent. This is the durable, per-member guard.
  if (authorization.status !== "active" || authorization.expiresAt <= nowIso) {
    const reason: ContributionReason =
      authorization.status === "revoked"
        ? "authorization_revoked"
        : authorization.status === "expired"
          ? "authorization_expired"
          : "no_authorization";
    store.markSkipped(memberId, period, reason, nowIso);
    return { memberId, status: "skipped", reason };
  }

  // P9-6: durable idempotency — claim first. If a row already exists for this
  // member + period (any outcome, including from a previous process run) we do
  // NOT call the signer again, so a second execution never creates a second
  // contribution.
  const claim = store.claimContribution(memberId, period, nowIso);
  if (!claim.claimed) {
    const existing = claim.record;
    if (!existing) {
      return { memberId, status: "skipped", reason: "existing_outcome_missing" };
    }
    if (existing.status === "contributed") {
      return { memberId, status: "contributed", txHash: existing.txHash ?? undefined };
    }
    // A 'claimed' row left behind by a crash between claim and submit is
    // ALSO terminal for this period (the contribution was never sent): record
    // it as a durable skip so the ledger stays consistent.
    if (existing.status === "claimed") {
      store.markSkipped(memberId, period, existingReason("claimed"), nowIso);
    }
    const status: RoundMemberStatus =
      existing.status === "failed" ? "failed" : "skipped";
    return {
      memberId,
      status,
      reason: existing.reason ?? existingReason(existing.status),
      txHash: existing.txHash ?? undefined,
    };
  }

  // P9-8: one member's failing signer must never stop the run — each member is
  // wrapped in its own try/catch and the failure is classified and recorded
  // durably (a policy rejection becomes `rejected_by_policy`, otherwise the
  // original message is kept).
  try {
    const receipt = await signer.submitContribution({
      walletAddress: authorization.walletAddress as Address,
      to,
      valueWei,
    });
    store.markContributed(memberId, period, receipt.hash, nowIso);
    return { memberId, status: "contributed", txHash: receipt.hash };
  } catch (err) {
    const reason = classifyContributionError(err);
    store.markFailed(memberId, period, reason, nowIso);
    return { memberId, status: "failed", reason };
  }
}

export async function runContributionRound(opts: RoundOptions): Promise<RoundOutcome> {
  const now = opts.now ?? new Date();
  const nowIso = now.toISOString();
  const period = opts.period ?? currentPeriod(now);

  opts.store.markExpired(nowIso);
  const memberships = opts.store.listMemberships();

  const results: RoundMemberResult[] = [];
  for (const membership of memberships) {
    results.push(
      await processMember({
        membership,
        store: opts.store,
        signer: opts.signer,
        to: opts.to,
        valueWei: opts.valueWei,
        period,
        nowIso,
      }),
    );
  }

  const contributed = results.filter((r) => r.status === "contributed").length;
  const skipped = results.filter((r) => r.status === "skipped").length;
  const failed = results.filter((r) => r.status === "failed").length;

  return { period, processed: results.length, contributed, skipped, failed, results };
}