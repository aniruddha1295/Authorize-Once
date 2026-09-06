import "dotenv/config";
import { PrivyClient } from "@privy-io/server-auth";
import { assertServerConfigured } from "../lib/config";
import { ensureContributionPolicy } from "../lib/policy";
import {
  buildContributionPolicy,
  summarizePolicy,
} from "../policies/contribution-policy";

async function main(): Promise<void> {
  // Fails fast unless PRIVY_APP_ID, PRIVY_APP_SECRET and
  // PRIVY_AUTHORIZATION_PRIVATE_KEY are set (P9-5: the backend
  // authorization private key is loaded from the environment at startup,
  // never committed, never interpolated into the client).
  const cfg = assertServerConfigured();
  console.log(`Privy app configured: ${cfg.privyAppId}`);
  console.log(
    "Authorization key: PRESENT (loaded from the process environment at runtime)",
  );

  const policy = buildContributionPolicy({
    contractAddress: cfg.contributionContractAddress,
    weeklyCapWei: cfg.weeklyCapWei,
  });
  console.log("Committed single grant policy (P9-2 contract allowlist, P9-3 value cap):");
  for (const line of summarizePolicy(policy)) console.log(`  ${line}`);

  const client = new PrivyClient(cfg.privyAppId, cfg.privyAppSecret, {
    walletApi: { authorizationPrivateKey: cfg.authorizationPrivateKey },
  });

  const token = process.argv[2];
  if (token) {
    try {
      const claims = await client.verifyAuthToken(token);
      console.log(`Token verified. User: ${claims.userId}`);
    } catch (err) {
      console.error(`Token verification failed: ${(err as Error).message}`);
      process.exitCode = 1;
    }
  } else {
    console.log("No token supplied. Pass one to verify its signature:");
    console.log("  npm run check:auth -- <access-token> [--create-policy]");
  }

  if (process.argv.includes("--create-policy")) {
    const created = await ensureContributionPolicy(client.walletApi, {
      contractAddress: cfg.contributionContractAddress,
      weeklyCapWei: cfg.weeklyCapWei,
    });
    console.log(`Policy provisioned on Privy: ${created.name} (${created.id})`);
  }

  console.log("check:auth ok");
}

main().catch((err) => {
  console.error(`check:auth failed: ${(err as Error).message}`);
  process.exitCode = 1;
});