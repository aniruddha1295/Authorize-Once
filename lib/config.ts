import path from "node:path";
import type { Address } from "viem";

export const DEFAULT_CONTRACT_ADDRESS = "0x0000000000000000000000000000000000000000";
export const DEFAULT_WEEKLY_CAP_WEI = "10000000000000000"; // 0.01 ETH
export const DEFAULT_AUTHORIZATION_TTL_SECONDS = 7776000; // 90 days
// The challenge ("Authorize Once, Then Stop Asking", Road To Devcon - III)
// specifies Base Sepolia as the contribution network.
export const DEFAULT_CAIP2_CHAIN = "eip155:84532"; // Base Sepolia

export class ConfigError extends Error {
  readonly status = 500;
  readonly code = "SERVER_NOT_CONFIGURED";
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

export interface ServerConfig {
  privyAppId: string;
  privyAppSecret: string;
  authorizationPrivateKey: string;
  contributionContractAddress: Address;
  weeklyCapWei: string;
  authorizationTtlSeconds: number;
  caip2Chain: string;
  dbPath: string;
}

export function parseWei(envValue: string | undefined, fallback: string): string {
  const value = envValue?.trim() || fallback;
  if (!/^[0-9]+$/.test(value)) throw new ConfigError(`Invalid wei value '${value}'.`);
  if (BigInt(value) <= 0n) throw new ConfigError(`Wei value must be greater than zero.`);
  return value;
}

export function parseTtlSeconds(envValue: string | undefined, fallback: number): number {
  const value = Number(envValue ?? fallback);
  if (!Number.isInteger(value) || value <= 0) {
    throw new ConfigError(`AUTHORIZATION_TTL_SECONDS must be a positive integer.`);
  }
  return value;
}

export function getServerConfig(): ServerConfig {
  return {
    privyAppId: process.env.PRIVY_APP_ID ?? "",
    privyAppSecret: process.env.PRIVY_APP_SECRET ?? "",
    authorizationPrivateKey: process.env.PRIVY_AUTHORIZATION_PRIVATE_KEY ?? "",
    contributionContractAddress: (
      process.env.CONTRIBUTION_CONTRACT_ADDRESS?.trim() || DEFAULT_CONTRACT_ADDRESS
    ) as Address,
    weeklyCapWei: parseWei(
      process.env.WEEKLY_CONTRIBUTION_CAP_WEI,
      DEFAULT_WEEKLY_CAP_WEI,
    ),
    authorizationTtlSeconds: parseTtlSeconds(
      process.env.AUTHORIZATION_TTL_SECONDS,
      DEFAULT_AUTHORIZATION_TTL_SECONDS,
    ),
    caip2Chain: process.env.CAIP2_CHAIN?.trim() || DEFAULT_CAIP2_CHAIN,
    dbPath: process.env.DB_PATH?.trim() || path.join(process.cwd(), "data", "circle.db"),
  };
}

export function assertServerConfigured(cfg: ServerConfig = getServerConfig()): ServerConfig {
  const missing: string[] = [];
  if (!cfg.privyAppId) missing.push("PRIVY_APP_ID");
  if (!cfg.privyAppSecret) missing.push("PRIVY_APP_SECRET");
  if (!cfg.authorizationPrivateKey) missing.push("PRIVY_AUTHORIZATION_PRIVATE_KEY");
  if (missing.length > 0) {
    throw new ConfigError(
      `Savings circle backend is not configured. Set ${missing.join(", ")} in .env and restart.`,
    );
  }
  return cfg;
}

export interface PublicCircleConfig {
  privyAppId: string;
  circleName: string;
  weeklyCapEth: string;
  weeklyCapWei: string;
  contractAddress: Address;
  authorizationTtlDays: number;
  caip2Chain: string;
}

export function weiToEth(wei: string): string {
  const value = BigInt(wei) / 10n ** 16n; // 2 decimals from wei
  return (Number(value) / 100).toFixed(2);
}

export function getPublicCircleConfig(): PublicCircleConfig {
  const server = getServerConfig();
  return {
    privyAppId: server.privyAppId,
    circleName: process.env.NEXT_PUBLIC_CIRCLE_NAME?.trim() || "Sunday Savings Circle",
    weeklyCapWei: server.weeklyCapWei,
    weeklyCapEth: weiToEth(server.weeklyCapWei),
    contractAddress: server.contributionContractAddress,
    authorizationTtlDays: Math.round(server.authorizationTtlSeconds / 86400),
    caip2Chain: server.caip2Chain,
  };
}