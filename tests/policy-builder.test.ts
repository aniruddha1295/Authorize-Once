import { describe, expect, it } from "vitest";
import type { Address } from "viem";
import {
  buildContributionPolicy,
  CONTRIBUTION_POLICY_NAME,
  summarizePolicy,
} from "@/policies/contribution-policy";

const CONTRACT = ("0x" + "ab".repeat(20)) as Address;

describe("P9-2/P9-3 — committed single-grant policy", () => {
  it("allows eth_sendTransaction only to the contract address", () => {
    const policy = buildContributionPolicy({
      contractAddress: CONTRACT,
      weeklyCapWei: "10000000000000000",
    });
    const allow = policy.rules.find((r) => r.action === "ALLOW");
    expect(allow).toBeDefined();
    expect(allow?.method).toBe("eth_sendTransaction");
    expect(allow?.conditions).toEqual(
      expect.arrayContaining([
        {
          fieldSource: "ethereum_transaction",
          field: "to",
          operator: "in",
          value: [CONTRACT],
        },
      ]),
    );
  });

  it("caps the value in the policy itself (P9-3), not only in code", () => {
    const policy = buildContributionPolicy({
      contractAddress: CONTRACT,
      weeklyCapWei: "123",
    });
    const allow = policy.rules.find((r) => r.action === "ALLOW");
    expect(allow?.conditions).toEqual(
      expect.arrayContaining([
        {
          fieldSource: "ethereum_transaction",
          field: "value",
          operator: "lte",
          value: "123",
        },
      ]),
    );
  });

  it("denies everything else with a catch-all rule", () => {
    const policy = buildContributionPolicy({
      contractAddress: CONTRACT,
      weeklyCapWei: "10000000000000000",
    });
    const deny = policy.rules.filter((r) => r.action === "DENY");
    expect(deny).toHaveLength(1);
    expect(deny[0]?.method).toBe("*");
    // the deny catch-all must run AFTER the allow rule
    expect(policy.rules.indexOf(deny[0]!)).toBe(1);
  });

  it("is eth-chain, versioned, and named for the circle", () => {
    const policy = buildContributionPolicy({
      contractAddress: CONTRACT,
      weeklyCapWei: "10000000000000000",
    });
    expect(policy.name).toBe(CONTRIBUTION_POLICY_NAME);
    expect(policy.version).toBe("1.0");
    expect(policy.chainType).toBe("ethereum");
  });

  it("rejects an invalid contract address or zero/invalid cap", () => {
    expect(() =>
      buildContributionPolicy({ contractAddress: "0xnot-an-address" as Address, weeklyCapWei: "1" }),
    ).toThrow(/Invalid contract address/);
    expect(() =>
      buildContributionPolicy({ contractAddress: CONTRACT, weeklyCapWei: "0" }),
    ).toThrow(/positive integer/);
    expect(() =>
      buildContributionPolicy({ contractAddress: CONTRACT, weeklyCapWei: "abc" }),
    ).toThrow(/positive integer/);
  });

  it("refuses to pin the zero placeholder as the contribution contract (P9-2), forcing operator config", () => {
    const zero = ("0x" + "00".repeat(20)) as Address;
    expect(() =>
      buildContributionPolicy({ contractAddress: zero, weeklyCapWei: "10000000000000000" }),
    ).toThrow(/zero placeholder/);
  });

  it("summarizes the scope for humans", () => {
    const lines = summarizePolicy(
      buildContributionPolicy({ contractAddress: CONTRACT, weeklyCapWei: "10000000000000000" }),
    );
    expect(lines[0]).toContain("ALLOW eth_sendTransaction");
    expect(lines[0]).toContain("to in");
    expect(lines[0]).toContain("value lte");
    expect(lines[1]).toBe("DENY *");
  });
});