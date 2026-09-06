import type { NextRequest } from "next/server";
import { requireAuthedToken, sendError } from "@/lib/http";
import { loadCircleStore } from "@/lib/store-loader";
import { getPublicCircleConfig } from "@/lib/config";
import { buildContributionPolicy } from "@/policies/contribution-policy";

export async function GET(req: NextRequest) {
  try {
    const { userId } = await requireAuthedToken(req);
    const store = loadCircleStore();
    const member = store.getMember(userId);
    const authorization = member ? store.getAuthorization(userId) : undefined;
    const contributions = member ? store.getContributions(userId) : [];
    const cfg = getPublicCircleConfig();
    return Response.json({
      member,
      authorization,
      contributions,
      circle: {
        name: cfg.circleName,
        weeklyCapEth: cfg.weeklyCapEth,
        weeklyCapWei: cfg.weeklyCapWei,
        contractAddress: cfg.contractAddress,
        authorizationTtlDays: cfg.authorizationTtlDays,
        caip2Chain: cfg.caip2Chain,
        policy: buildContributionPolicy({
          contractAddress: cfg.contractAddress,
          weeklyCapWei: cfg.weeklyCapWei,
        }),
      },
    });
  } catch (err) {
    return sendError(err);
  }
}