"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  getEmbeddedConnectedWallet,
  useDelegatedActions,
  usePrivy,
  useWallets,
} from "@privy-io/react-auth";
import type { Address } from "viem";
import { ApiError, DelegationUnavailableError, userFacingErrorMessage } from "@/lib/errors";

type AuthorizationStatus = "active" | "revoked" | "expired";
type Phase = "loading" | "idle" | "joining" | "revoking";

interface ApiAuthorization {
  memberId: string;
  walletAddress: string;
  chainType: string;
  status: AuthorizationStatus;
  grantedAt: string;
  expiresAt: string;
  revokedAt: string | null;
}

interface ApiContribution {
  id: string;
  memberId: string;
  period: string;
  status: "claimed" | "contributed" | "skipped" | "failed";
  reason: string | null;
  txHash: string | null;
  createdAt: string;
  updatedAt: string;
}

interface ApiMember {
  memberId: string;
  walletAddress: string;
  joinedAt: string;
}

interface ApiPolicy {
  name: string;
  version: string;
  chainType: string;
  rules: Array<{
    name: string;
    action: string;
    method: string;
    conditions: Array<Record<string, unknown>>;
  }>;
}

interface ApiCircle {
  name: string;
  weeklyCapEth: string;
  weeklyCapWei: string;
  contractAddress: Address;
  authorizationTtlDays: number;
  caip2Chain: string;
  policy?: ApiPolicy;
}

interface MeResponse {
  member: ApiMember | null;
  authorization: ApiAuthorization | null;
  contributions: ApiContribution[];
  circle: ApiCircle;
}

interface JoinResponse {
  member: ApiMember;
  authorization: ApiAuthorization;
  circle: ApiCircle;
}

function shortAddress(address: string): string {
  if (address.length <= 12) return address;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function policyScopeLines(policy?: ApiPolicy): string[] {
  if (!policy) return [];
  return policy.rules.map((rule) => {
    const conditions = rule.conditions
      .map((c) => {
        const field = String(c.field ?? "*");
        const op = String(c.operator);
        const value = Array.isArray(c.value) ? c.value.join(", ") : String(c.value);
        return `${field} ${op} ${value}`;
      })
      .join(" AND ");
    return `${rule.action} ${rule.method}${conditions ? ` (${conditions})` : ""}`;
  });
}

export function CircleDashboard() {
  const { logout, getAccessToken } = usePrivy();
  const { wallets } = useWallets();
  const { delegateWallet, revokeWallets } = useDelegatedActions();

  const [phase, setPhase] = useState<Phase>("loading");
  const [me, setMe] = useState<MeResponse | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const embeddedWallet = useMemo(() => getEmbeddedConnectedWallet(wallets), [wallets]);

  const bearerHeaders = useCallback(async () => {
    return { Authorization: `Bearer ${await getAccessToken()}` };
  }, [getAccessToken]);

  const refreshMember = useCallback(async (): Promise<MeResponse> => {
    const res = await fetch("/api/me", { headers: await bearerHeaders() });
    const data = (await res.json().catch(() => ({}))) as {
      member?: ApiMember | null;
      authorization?: ApiAuthorization | null;
      contributions?: ApiContribution[];
      circle?: ApiCircle;
    };
    if (!res.ok || !data.circle) {
      throw new ApiError(
        data.circle ? "Server rejected /api/me." : `Server rejected /api/me (HTTP ${res.status}).`,
        res.status,
      );
    }
    return data as MeResponse;
  }, [bearerHeaders]);

  useEffect(() => {
    let cancelled = false;
    refreshMember()
      .then((data) => {
        if (!cancelled) setMe(data);
      })
      .catch(() => {
        // a failed restore should never block the dashboard
      })
      .finally(() => {
        if (!cancelled) setPhase("idle");
      });
    return () => {
      cancelled = true;
    };
  }, [refreshMember]);

  const joined = Boolean(me?.authorization);
  const authorizationStatus = me?.authorization?.status ?? null;

  const onJoin = async () => {
    setErrorMessage(null);
    if (!embeddedWallet) {
      setErrorMessage(
        new DelegationUnavailableError(
          "Your wallet is still being prepared. Wait a moment, then tap Join the circle again.",
        ).message,
      );
      return;
    }
    setPhase("joining");
    try {
      // P9-1 — the Privy SDK grant flow: the user approves the delegation
      // right here (they can always decline or revoke it later).
      await delegateWallet({
        address: embeddedWallet.address,
        chainType: "ethereum",
      });
      const res = await fetch("/api/join", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await bearerHeaders()) },
        body: JSON.stringify({ walletAddress: embeddedWallet.address }),
      });
      const data = (await res.json().catch(() => ({}))) as JoinResponse & { error?: string };
      if (!res.ok || !data.authorization) {
        throw new ApiError(
          data.error ?? `Server rejected /api/join (HTTP ${res.status}).`,
          res.status,
        );
      }
      setMe({
        member: data.member,
        authorization: data.authorization,
        contributions: [],
        circle: data.circle,
      });
      setPhase("idle");
    } catch (err) {
      setErrorMessage(userFacingErrorMessage(err));
      setPhase("idle");
    }
  };

  const onRevoke = async () => {
    setErrorMessage(null);
    setPhase("revoking");
    let sdkError: string | null = null;
    try {
      // P9-7 — the Privy SDK revocation (revokes ALL user-delegated wallets).
      await revokeWallets();
    } catch (err) {
      sdkError = userFacingErrorMessage(
        err,
        "Privy reported an error revoking the delegation.",
      );
    }
    try {
      const res = await fetch("/api/revoke", {
        method: "POST",
        headers: await bearerHeaders(),
      });
      const data = (await res.json().catch(() => ({}))) as {
        authorization?: ApiAuthorization;
        error?: string;
      };
      if (!res.ok || !data.authorization) {
        throw new ApiError(
          data.error ?? `Server rejected /api/revoke (HTTP ${res.status}).`,
          res.status,
        );
      }
      const refreshed = await refreshMember();
      setMe(refreshed);
      setPhase("idle");
      setErrorMessage(sdkError);
    } catch (err) {
      setErrorMessage(userFacingErrorMessage(err));
      setPhase("idle");
    }
  };

  const policyLines = policyScopeLines(me?.circle?.policy);
  const scope = `Only ${me?.circle ? `eth_sendTransaction to ${shortAddress(me.circle.contractAddress)} with value <= ${me.circle.weeklyCapEth} ETH` : "the committed policy"} — nothing else.`;

  return (
    <div className="card" data-testid="circle-dashboard">
      <div className="row">
        <h1>{me?.circle?.name ?? "Savings circle"}</h1>
        <button onClick={() => void logout()}>Sign out</button>
      </div>
      <p className="muted">
        Authorize once, then stop asking. One durable grant, a weekly capped contribution,
        revocable and expiring.
      </p>

      <div className="row">
        <span>Your circle</span>
        <code data-testid="circle-ttl">
          {me?.circle
            ? `${me.circle.weeklyCapEth} ETH/week · grant expires in ${me.circle.authorizationTtlDays} days`
            : "Loading…"}
        </code>
      </div>

      <div className="row">
        <span>Watch wallet</span>
        {embeddedWallet ? (
          <code data-testid="embedded-wallet-address">{embeddedWallet.address}</code>
        ) : (
          <span className="muted" data-testid="embedded-wallet-status">
            Creating your wallet…
          </span>
        )}
      </div>

      {phase === "loading" ? <p className="muted">Checking your grant…</p> : null}

      {me?.circle ? (
        <div className="stack">
          <p className="muted">The one grant lets the backend do only this — committed policy:</p>
          <ul data-testid="policy-rules">
            {policyLines.length > 0
              ? policyLines.map((line) => <li key={line}>{line}</li>)
              : [<li key="scope">{scope}</li>]}
          </ul>
        </div>
      ) : null}

      {errorMessage ? (
        <div className="status-failed" data-testid="error-message">
          {errorMessage}
        </div>
      ) : null}

      {!joined ? (
        <div className="stack">
          <p className="muted">
            Joining runs the Privy <strong>delegated-actions</strong> grant flow once. The
            backend may then, and only then, send <code>eth_sendTransaction</code> per the
            committed policy above.
          </p>
          <button
            className="primary"
            data-testid="join-button"
            disabled={!embeddedWallet || phase === "joining" || phase === "revoking"}
            onClick={() => void onJoin()}
          >
            {phase === "joining" ? "Awaiting your approval…" : "Authorize once & join"}
          </button>
          {phase === "joining" ? (
            <p className="status-pending" data-testid="status-joining">
              Open the Privy approval, then come back — this is the one and only prompt.
            </p>
          ) : null}
        </div>
      ) : null}

      {joined && me ? (
        <div className="stack">
          <div className="row">
            <span>Authorization</span>
            <span data-testid="authorization-status" className={`chip ${authorizationStatus === "active" ? "ok" : authorizationStatus === "expired" ? "warn" : "bad"}`}>
              {authorizationStatus}
            </span>
          </div>
          <div className="row">
            <span>Delegated wallet</span>
            <code>{me.authorization?.walletAddress ?? "—"}</code>
          </div>
          {me.authorization ? (
            <>
              <div className="row">
                <span>Granted</span>
                <code data-testid="granted-at">{me.authorization.grantedAt}</code>
              </div>
              <div className="row">
                <span>Expires</span>
                <code data-testid="expires-at">{me.authorization.expiresAt}</code>
              </div>
              {me.authorization.revokedAt ? (
                <div className="row">
                  <span>Revoked</span>
                  <code data-testid="revoked-at">{me.authorization.revokedAt}</code>
                </div>
              ) : null}
            </>
          ) : null}

          <p className="muted">
            The grant cannot do more than the committed scope above. When it expires or is
            revoked, the scheduler stops contributing and records the skip.
          </p>

          <h2>Weekly outcome ledger</h2>
          {me.contributions.length === 0 ? (
            <p className="muted" data-testid="no-contributions">
              No scheduled runs yet. The backend records every contributed / skipped /
              failed week here.
            </p>
          ) : (
            <table className="outcomes" data-testid="outcomes-table">
              <thead>
                <tr>
                  <th>Period</th>
                  <th>Status</th>
                  <th>Detail</th>
                </tr>
              </thead>
              <tbody>
                {me.contributions.map((c) => (
                  <tr key={c.id} data-testid={`outcome-${c.period}`}>
                    <td>{c.period}</td>
                    <td>
                      <span className={`chip ${c.status === "contributed" ? "ok" : c.status === "skipped" ? "warn" : "bad"}`}>
                        {c.status}
                      </span>
                    </td>
                    <td>
                      {c.txHash ? <code>{c.txHash}</code> : null}
                      {c.reason ? <span className="muted"> {c.reason}</span> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {authorizationStatus === "active" ? (
            <button
              className="danger"
              data-testid="revoke-button"
              disabled={phase === "revoking" || phase === "joining"}
              onClick={() => void onRevoke()}
            >
              {phase === "revoking" ? "Revoking…" : "Revoke authorization"}
            </button>
          ) : (
            <div className="row">
              <span className="muted">
                Authorization {authorizationStatus}. The scheduler will skip you.
              </span>
              <button
                className="primary"
                data-testid="rejoin-button"
                disabled={!embeddedWallet || phase === "joining"}
                onClick={() => void onJoin()}
              >
                Authorize again
              </button>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}