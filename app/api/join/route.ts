import type { NextRequest } from "next/server";
import { isAddress, type Address } from "viem";
import { getPublicCircleConfig, getServerConfig } from "@/lib/config";
import { HttpError, requireAuthedToken, sendError } from "@/lib/http";
import { loadCircleStore } from "@/lib/store-loader";

export async function POST(req: NextRequest) {
  try {
    const { userId } = await requireAuthedToken(req);
    const body = (await req.json().catch(() => null)) as {
      walletAddress?: unknown;
    } | null;
    if (!body) {
      throw new HttpError(400, "INVALID_BODY", "Request body must be JSON.");
    }
    const walletAddress =
      typeof body.walletAddress === "string" && isAddress(body.walletAddress)
        ? (body.walletAddress as Address)
        : null;
    if (!walletAddress) {
      throw new HttpError(400, "INVALID_WALLET", "walletAddress must be a valid 0x address.");
    }

    // The client already ran the Privy delegated-actions grant flow
    // (`delegateWallet`, P9-1) before calling us; here we record the durable
    // membership and a fresh, time-bounded authorization for the scheduler.
    const server = getServerConfig();
    const store = loadCircleStore();
    const now = new Date();
    const nowIso = now.toISOString();
    store.ensureMember(userId, walletAddress, nowIso);
    const authorization = store.setAuthorization(
      userId,
      walletAddress,
      "ethereum",
      server.authorizationTtlSeconds,
      nowIso,
    );

    const cfg = getPublicCircleConfig();
    return Response.json({
      member: store.getMember(userId),
      authorization,
      circle: {
        name: cfg.circleName,
        weeklyCapEth: cfg.weeklyCapEth,
        weeklyCapWei: cfg.weeklyCapWei,
        contractAddress: cfg.contractAddress,
        authorizationTtlDays: cfg.authorizationTtlDays,
        caip2Chain: cfg.caip2Chain,
      },
    });
  } catch (err) {
    return sendError(err);
  }
}