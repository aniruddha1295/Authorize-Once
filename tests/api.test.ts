import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TokenVerificationError } from "@/lib/auth";
import { resetCircleStore } from "@/lib/store-loader";
import { GET as me } from "@/app/api/me/route";
import { POST as join } from "@/app/api/join/route";
import { POST as revoke } from "@/app/api/revoke/route";

const AUTH = vi.hoisted(() => ({ verifyAccessToken: vi.fn() }));

vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = (await importOriginal()) as typeof import("@/lib/auth");
  return { ...actual, verifyAccessToken: AUTH.verifyAccessToken };
});

const dirs: string[] = [];
const WALLET = "0x" + "ab".repeat(20);

function jsonRequest(
  url: string,
  { method = "POST", body, token }: { method?: string; body?: unknown; token?: string } = {},
): NextRequest {
  return new Request(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  }) as unknown as NextRequest;
}

beforeEach(() => {
  AUTH.verifyAccessToken.mockReset();
  AUTH.verifyAccessToken.mockResolvedValue({ userId: "user-1" });

  const dir = mkdtempSync(path.join(tmpdir(), "rtd-p9-api-"));
  dirs.push(dir);
  process.env.DB_PATH = path.join(dir, "circle.db");
  // /api/me builds the COMMITTED policy, which only allowlists a real
  // contribution contract — never the zero placeholder — so tests provide one.
  process.env.CONTRIBUTION_CONTRACT_ADDRESS = WALLET;
  resetCircleStore();
});

afterEach(() => {
  resetCircleStore();
  delete process.env.DB_PATH;
  delete process.env.CONTRIBUTION_CONTRACT_ADDRESS;
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  dirs.length = 0;
});

describe("P9-1/P9-7 — join / revoke / me", () => {
  it("rejects an unauthenticated or invalid join with 401", async () => {
    const unauth = await join(jsonRequest("http://localhost/api/join"));
    expect(unauth.status).toBe(401);

    AUTH.verifyAccessToken.mockRejectedValue(new TokenVerificationError());
    const bad = await join(jsonRequest("http://localhost/api/join", { token: "garbage" }));
    expect(bad.status).toBe(401);
  });

  it("rejects a malformed wallet address with 400", async () => {
    const res = await join(
      jsonRequest("http://localhost/api/join", {
        token: "tok",
        body: { walletAddress: "0xnot-an-address" },
      }),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("INVALID_WALLET");
  });

  it("records a durable, time-bounded membership + authorization (P9-1/P9-4)", async () => {
    const res = await join(
      jsonRequest("http://localhost/api/join", { token: "tok", body: { walletAddress: WALLET } }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      member: { memberId: string; walletAddress: string };
      authorization: {
        status: string;
        chainType: string;
        expiresAt: string;
        revokedAt: string | null;
      };
      circle: { weeklyCapEth: string; authorizationTtlDays: number };
    };
    expect(body.member.memberId).toBe("user-1");
    expect(body.member.walletAddress).toBe(WALLET);
    expect(body.authorization.status).toBe("active");
    expect(body.authorization.chainType).toBe("ethereum");
    expect(body.authorization.revokedAt).toBeNull();
    expect(body.authorization.expiresAt > new Date().toISOString()).toBe(true);
    expect(body.circle.authorizationTtlDays).toBe(90);
  });

  it("/api/me surfaces the joined state, the circle info and the ledger (P9-3)", async () => {
    await join(jsonRequest("http://localhost/api/join", { token: "tok", body: { walletAddress: WALLET } }));
    const res = await me(jsonRequest("http://localhost/api/me", { method: "GET", token: "tok" }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      member: { memberId: string };
      authorization: { status: string; walletAddress: string };
      contributions: unknown[];
      circle: { policy: { name: string; rules: unknown[] } };
    };
    expect(body.member.memberId).toBe("user-1");
    expect(body.authorization.walletAddress).toBe(WALLET);
    expect(body.contributions).toEqual([]);
    expect(body.circle.policy.rules.length).toBeGreaterThan(0);
  });

  it("revokes the authorization and records it durably (P9-7), refusing a second revoke", async () => {
    await join(jsonRequest("http://localhost/api/join", { token: "tok", body: { walletAddress: WALLET } }));

    const revokedRes = await revoke(jsonRequest("http://localhost/api/revoke", { token: "tok" }));
    expect(revokedRes.status).toBe(200);
    const revoked = (await revokedRes.json()) as { authorization: { status: string; revokedAt: string | null } };
    expect(revoked.authorization.status).toBe("revoked");
    expect(revoked.authorization.revokedAt).toBeTruthy();

    const second = await revoke(jsonRequest("http://localhost/api/revoke", { token: "tok" }));
    expect(second.status).toBe(404);
  });
});