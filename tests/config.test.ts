import { afterEach, describe, expect, it } from "vitest";
import {
  ConfigError,
  DEFAULT_CONTRACT_ADDRESS,
  DEFAULT_WEEKLY_CAP_WEI,
  assertServerConfigured,
  getPublicCircleConfig,
  getServerConfig,
  parseTtlSeconds,
  parseWei,
  weiToEth,
} from "@/lib/config";

const REQUIRED = {
  PRIVY_APP_ID: "app-id",
  PRIVY_APP_SECRET: "app-secret",
  PRIVY_AUTHORIZATION_PRIVATE_KEY: "sk-backend-auth-key",
};

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (key.startsWith("PRIVY") || ["CONTRIBUTION_CONTRACT_ADDRESS", "WEEKLY_CONTRIBUTION_CAP_WEI", "AUTHORIZATION_TTL_SECONDS", "CAIP2_CHAIN", "DB_PATH"].includes(key)) {
      delete process.env[key];
    }
  }
});

describe("P9-5 — env-driven server configuration", () => {
  it("reads server config from the environment", () => {
    process.env.PRIVY_APP_ID = "app-1";
    process.env.PRIVY_APP_SECRET = "sec-1";
    process.env.PRIVY_AUTHORIZATION_PRIVATE_KEY = "sk-key-1";
    process.env.AUTHORIZATION_TTL_SECONDS = "3600";
    const cfg = getServerConfig();
    expect(cfg.privyAppId).toBe("app-1");
    expect(cfg.privyAppSecret).toBe("sec-1");
    expect(cfg.authorizationPrivateKey).toBe("sk-key-1");
    expect(cfg.authorizationTtlSeconds).toBe(3600);
  });

  it("refuses to start when any required secret is unset (auth private key included)", () => {
    delete process.env.PRIVY_APP_ID;
    process.env.PRIVY_APP_SECRET = "sec";
    process.env.PRIVY_AUTHORIZATION_PRIVATE_KEY = "key";
    expect(() => assertServerConfigured()).toThrow(ConfigError);

    process.env.PRIVY_APP_ID = "app";
    delete process.env.PRIVY_AUTHORIZATION_PRIVATE_KEY;
    expect(() => assertServerConfigured()).toThrow(/\bPRIVY_AUTHORIZATION_PRIVATE_KEY\b/);
  });

  it("applies safe defaults for the two crypto knobs", () => {
    process.env.PRIVY_APP_ID = "app";
    process.env.PRIVY_APP_SECRET = "sec";
    process.env.PRIVY_AUTHORIZATION_PRIVATE_KEY = "key";
    const cfg = getServerConfig();
    expect(cfg.contributionContractAddress).toBe(DEFAULT_CONTRACT_ADDRESS);
    expect(cfg.weeklyCapWei).toBe(DEFAULT_WEEKLY_CAP_WEI);
    expect(cfg.caip2Chain).toBe("eip155:84532"); // Base Sepolia (challenge network)
  });

  it("validates the wei cap and TTL", () => {
    expect(parseWei("10000000000000000", "x")).toBe("10000000000000000");
    expect(() => parseWei("-5", "x")).toThrow(ConfigError);
    expect(() => parseWei("0", "x")).toThrow(ConfigError);
    expect(parseTtlSeconds("90", 1)).toBe(90);
    expect(() => parseTtlSeconds("abc", 1)).toThrow(ConfigError);
    expect(() => parseTtlSeconds("0", 1)).toThrow(ConfigError);
  });

  it("exposes the public circle config with an ETH-formatted cap", () => {
    process.env.PRIVY_APP_ID = "app";
    process.env.PRIVY_APP_SECRET = "sec";
    process.env.PRIVY_AUTHORIZATION_PRIVATE_KEY = "key";
    process.env.CONTRIBUTION_CONTRACT_ADDRESS = "0x" + "ab".repeat(20);
    process.env.AUTHORIZATION_TTL_SECONDS = "7776000";
    const pub = getPublicCircleConfig();
    expect(pub.weeklyCapWei).toBe("10000000000000000");
    expect(pub.weeklyCapEth).toBe("0.01");
    expect(pub.authorizationTtlDays).toBe(90);
  });

  it("formats wei as 2-decimal ETH", () => {
    expect(weiToEth("10000000000000000")).toBe("0.01");
    expect(weiToEth("1000000000000000000")).toBe("1.00");
    expect(weiToEth("150000000000000000")).toBe("0.15");
  });
});