import { getPublicCircleConfig } from "@/lib/config";
import { CircleShell } from "@/components/CircleShell";
import { Providers } from "./providers";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function SetupGate() {
  return (
    <div className="card" data-testid="setup-gate">
      <h1>Authorize Once, Then Stop Asking</h1>
      <p className="muted">
        A savings circle where you authorize once via a scoped, capped, expiring Privy
        grant and a durable scheduled backend makes the weekly contribution while you are
        offline.
      </p>
      <p>This demo needs a few environment variables before it runs. Copy <code>.env.example</code> to
        <code> .env</code> and set:</p>
      <ul>
        <li>
          <code>NEXT_PUBLIC_PRIVY_APP_ID</code>, <code>PRIVY_APP_ID</code>, <code>PRIVY_APP_SECRET</code>
        </li>
        <li>
          <code>PRIVY_AUTHORIZATION_PRIVATE_KEY</code> — the backend authorization key (P9-5)
        </li>
        <li>
          <code>CONTRIBUTION_CONTRACT_ADDRESS</code> — the allowlisted circle contract
        </li>
      </ul>
    </div>
  );
}

export default function HomePage() {
  const cfg = getPublicCircleConfig();
  if (!cfg.privyAppId) return <SetupGate />;
  return (
    <Providers>
      <CircleShell />
    </Providers>
  );
}