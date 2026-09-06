import type { NextRequest } from "next/server";
import { HttpError, requireAuthedToken, sendError } from "@/lib/http";
import { loadCircleStore } from "@/lib/store-loader";

export async function POST(req: NextRequest) {
  try {
    const { userId } = await requireAuthedToken(req);
    const store = loadCircleStore();
    const now = new Date().toISOString();
    const authorization = store.revokeAuthorization(userId, now);
    if (!authorization) {
      throw new HttpError(404, "NO_AUTHORIZATION", "No authorization to revoke.");
    }
    return Response.json({ authorization });
  } catch (err) {
    return sendError(err);
  }
}