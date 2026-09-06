import type {
  EvmCaip2ChainId,
  EthereumSendTransactionInputType,
  EthereumSendTransactionResponseType,
} from "@privy-io/server-auth";
import type { Address, Hex } from "viem";

export interface ContributionSubmission {
  walletAddress: Address;
  to: Address;
  valueWei: bigint;
}

export interface ContributionReceipt {
  hash: string;
  caip2: EvmCaip2ChainId;
}

export interface ContributionSigner {
  submitContribution(tx: ContributionSubmission): Promise<ContributionReceipt>;
}

/**
 * Raised when the Wallet API refuses a delegated transaction — e.g. the
 * committed policy DENYed the request (out-of-scope destination or value).
 * The scheduler maps this to a durable `rejected_by_policy` outcome so the
 * rejection is recorded, not just logged (P9-8).
 */
export class ContributionRejectedError extends Error {
  readonly code = "rejected_by_policy";
  constructor(message: string) {
    super(message);
    this.name = "ContributionRejectedError";
  }
}

/**
 * Classifies a Wallet API submission error into a stable, durable reason.
 * Privy denial/rejection responses are folded into `rejected_by_policy`;
 * anything else keeps its message.
 */
export function classifyContributionError(err: unknown): string {
  if (err instanceof ContributionRejectedError) return err.code;
  if (err === undefined || err === null) return "unknown_error";
  const message = err instanceof Error ? err.message : String(err);
  if (/denied|deny|rejected|policy|unauthoriz|not allowed|NOT_ALLOWED/i.test(message)) {
    return "rejected_by_policy";
  }
  return message.trim() || "unknown_error";
}

/**
 * The slice of the Privy Wallet API used for delegated RPC calls — structural,
 * so tests substitute a lightweight fake.
 */
export interface WalletApiRpc {
  ethereum: {
    sendTransaction(
      input: EthereumSendTransactionInputType,
    ): Promise<EthereumSendTransactionResponseType>;
  };
}

/**
 * The real signer. Submits the weekly contribution through Privy's Wallet API
 * using the delegated-wallet request form (`address` + `chainType`). Every
 * request is automatically signed with the app's authorization private key
 * that was loaded from the environment when the `WalletApi` was constructed
 * (see lib/auth.ts). The committed policy built by
 * policies/contribution-policy.ts is what authorizes this exact call on
 * Privy's side.
 */
export class PrivyWalletApiSigner implements ContributionSigner {
  constructor(
    private readonly walletApi: WalletApiRpc,
    private readonly caip2: EvmCaip2ChainId,
  ) {}

  async submitContribution(tx: ContributionSubmission): Promise<ContributionReceipt> {
    const response = await this.walletApi.ethereum.sendTransaction({
      address: tx.walletAddress,
      chainType: "ethereum",
      transaction: {
        to: tx.to as Hex,
        value: ("0x" + tx.valueWei.toString(16)) as Hex,
      },
      caip2: this.caip2,
    });
    return { hash: response.hash, caip2: response.caip2 };
  }
}