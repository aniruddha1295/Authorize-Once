import type { WalletApiPolicyCreateRequestType } from "@privy-io/server-auth";
import type { Address } from "viem";
import { isAddress } from "viem";

export const CONTRIBUTION_POLICY_NAME = "contribution-circle-weekly";
export const CONTRIBUTION_POLICY_VERSION = "1.0" as const;
export const ALLOW_RULE_NAME = "allow-weekly-contribution";
export const DENY_RULE_NAME = "deny-everything-else";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

export interface ContributionPolicyInput {
  contractAddress: Address;
  weeklyCapWei: string;
}

export function assertContributionPolicyInput(input: ContributionPolicyInput): ContributionPolicyInput {
  if (!isAddress(input.contractAddress)) {
    throw new Error(`Invalid contract address '${input.contractAddress}'.`);
  }
  if (input.contractAddress.toLowerCase() === ZERO_ADDRESS) {
    throw new Error(
      `CONTRIBUTION_CONTRACT_ADDRESS is the zero placeholder. ` +
        `Set it to the deployed ContributionCircle address before creating the ` +
        `committed policy (P9-2 destination allowlist).`,
    );
  }
  if (!/^[0-9]+$/.test(input.weeklyCapWei) || BigInt(input.weeklyCapWei) <= 0n) {
    throw new Error(`weeklyCapWei must be a positive integer string of wei.`);
  }
  return input;
}

/**
 * The COMMITTED policy for the savings circle. This is the single source of
 * truth for the grant's scope and is what gets pushed to the Privy Wallet API
 * via `walletApi.createPolicy(...)`. It is not just enforced in application
 * code: every rule below is a hard condition evaluated by Privy.
 *
 *   - P9-2  Contract allowlist: `eth_sendTransaction` is only allowed with
 *           `to IN [CONTRIBUTION_CONTRACT_ADDRESS]` — the committed
 *           `contracts/ContributionCircle.sol` target.
 *   - P9-3  Value cap: the same rule must also satisfy `value <= weeklyCapWei`
 *           (the ceiling lives in the policy, not only in the scheduler).
 *   - Catch-all: every other RPC method/action is DENIED.
 */
export function buildContributionPolicy(input: ContributionPolicyInput): WalletApiPolicyCreateRequestType {
  assertContributionPolicyInput(input);
  return {
    name: CONTRIBUTION_POLICY_NAME,
    version: CONTRIBUTION_POLICY_VERSION,
    chainType: "ethereum",
    rules: [
      {
        name: ALLOW_RULE_NAME,
        action: "ALLOW",
        method: "eth_sendTransaction",
        conditions: [
          {
            fieldSource: "ethereum_transaction",
            field: "to",
            operator: "in",
            value: [input.contractAddress],
          },
          {
            fieldSource: "ethereum_transaction",
            field: "value",
            operator: "lte",
            value: input.weeklyCapWei,
          },
        ],
      },
      {
        name: DENY_RULE_NAME,
        action: "DENY",
        method: "*",
        conditions: [],
      },
    ],
  };
}

export function summarizePolicy(policy: WalletApiPolicyCreateRequestType): string[] {
  return policy.rules.map(
    (rule) =>
      `${rule.action} ${rule.method}${rule.conditions
        .map((c) => ` ${c.fieldSource}.${"field" in c ? c.field : "*"} ${c.operator} ${Array.isArray(c.value) ? c.value.join(",") : c.value}`)
        .join(" AND")}`,
  );
}