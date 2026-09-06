import "dotenv/config";
import type { EvmCaip2ChainId } from "@privy-io/server-auth";
import { getPrivyClient } from "../lib/auth";
import { assertServerConfigured } from "../lib/config";
import { PrivyWalletApiSigner } from "../lib/contributor";
import { currentPeriod } from "../lib/periods";
import { runContributionRound } from "../lib/scheduler";
import { loadCircleStore } from "../lib/store-loader";

async function main(): Promise<void> {
  const cfg = assertServerConfigured();
  const period = currentPeriod();

  console.log("[rtd-p9] scheduled contribution round");
  console.log(`[rtd-p9] period=${period} (ISO week starting Monday)`);
  console.log(
    `[rtd-p9] to=${cfg.contributionContractAddress} valueWei=${cfg.weeklyCapWei} chain=${cfg.caip2Chain}`,
  );

  const store = loadCircleStore();
  const walletApi = getPrivyClient().walletApi;
  const signer = new PrivyWalletApiSigner(walletApi, cfg.caip2Chain as EvmCaip2ChainId);

  const outcome = await runContributionRound({
    store,
    signer,
    to: cfg.contributionContractAddress,
    valueWei: BigInt(cfg.weeklyCapWei),
    period,
  });

  console.log(
    `[rtd-p9] processed=${outcome.processed} contributed=${outcome.contributed} skipped=${outcome.skipped} failed=${outcome.failed}`,
  );
  for (const result of outcome.results) {
    console.log(
      `[rtd-p9]   ${result.status.padEnd(11)} ${result.memberId}${result.txHash ? ` tx=${result.txHash}` : ""}${result.reason ? ` reason=${result.reason}` : ""}`,
    );
  }

  store.close();
}

main().catch((err) => {
  console.error(`[rtd-p9] ${(err as Error).message}`);
  process.exitCode = 1;
});