"use client";
import { usePrivy } from "@privy-io/react-auth";

export const SUPPORTED_LOGIN_METHODS = ["google", "email"] as const;

export function LoginScreen() {
  const { login } = usePrivy();
  return (
    <div className="card" data-testid="login-screen">
      <h1>Savings circle</h1>
      <p className="muted">
        Authorize once, then stop asking. You approve a single scoped grant today; a durable
        scheduled backend makes the weekly contribution while you are offline — up to an
        expiring, policy-capped limit.
      </p>
      <button
        data-testid="signin-button"
        onClick={() => login({ loginMethods: [...SUPPORTED_LOGIN_METHODS] })}
      >
        Sign in to join the circle
      </button>
    </div>
  );
}