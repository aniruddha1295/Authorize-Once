import type { NextRequest } from "next/server";
import { ConfigError } from "./config";
import { AppConfigError, TokenVerificationError, readBearerToken, verifyAccessToken } from "./auth";

export class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.code = code;
  }
}

export async function requireAuthedToken(req: NextRequest): Promise<{ userId: string }> {
  const token = readBearerToken(req);
  if (!token) throw new TokenVerificationError();
  const claims = await verifyAccessToken(token);
  return { userId: claims.userId };
}

export function sendError(err: unknown): Response {
  if (
    err instanceof TokenVerificationError ||
    err instanceof AppConfigError ||
    err instanceof HttpError
  ) {
    return Response.json(
      { error: err.message, code: err.code },
      { status: err.status },
    );
  }
  if (err instanceof ConfigError) {
    return Response.json({ error: err.message, code: err.code }, { status: err.status });
  }
  console.error("[rtd-p9]", err);
  return Response.json({ error: "Internal server error." }, { status: 500 });
}