import type { NextRequest } from "next/server";
import { PrivyClient } from "@privy-io/server-auth";
import type { AuthTokenClaims } from "@privy-io/server-auth";
import { assertServerConfigured } from "./config";

export class AppConfigError extends Error {
  readonly status = 500;
  readonly code = "SERVER_NOT_CONFIGURED";
  constructor(message: string) {
    super(message);
    this.name = "AppConfigError";
  }
}

export class TokenVerificationError extends Error {
  readonly status = 401;
  readonly code = "INVALID_TOKEN";
  constructor(message = "Missing or invalid access token.") {
    super(message);
    this.name = "TokenVerificationError";
  }
}

let cachedClient: PrivyClient | null = null;

export function getPrivyClient(): PrivyClient {
  const cfg = assertServerConfigured();
  if (!cachedClient) {
    cachedClient = new PrivyClient(cfg.privyAppId, cfg.privyAppSecret, {
      walletApi: {
        // P9-5: the backend authorization key is read from the environment at
        // runtime — never committed — and signs every Wallet API request.
        authorizationPrivateKey: cfg.authorizationPrivateKey,
      },
    });
  }
  return cachedClient;
}

export function resetPrivyClient(): void {
  cachedClient = null;
}

export function readBearerToken(req: NextRequest): string | null {
  const header = req.headers.get("authorization");
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1].trim() : null;
}

export async function verifyAccessToken(token: string): Promise<AuthTokenClaims> {
  try {
    return await getPrivyClient().verifyAuthToken(token);
  } catch {
    throw new TokenVerificationError();
  }
}