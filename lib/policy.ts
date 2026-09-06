import type {
  WalletApiPolicyCreateRequestType,
  WalletApiPolicyResponseType,
} from "@privy-io/server-auth";
import {
  buildContributionPolicy,
  type ContributionPolicyInput,
} from "../policies/contribution-policy";

/**
 * The slice of the Privy Wallet API we depend on — kept structural so unit
 * tests inject a lightweight fake instead of the real class.
 */
export interface ContributionPolicyApi {
  createPolicy(
    input: WalletApiPolicyCreateRequestType,
  ): Promise<WalletApiPolicyResponseType>;
}

/**
 * Pushes the committed contribution policy to the real Privy Wallet API.
 * `createPolicy` is the delegated-actions policy store that restricts what the
 * backend may do with a member's delegated embedded wallet.
 */
export async function ensureContributionPolicy(
  walletApi: ContributionPolicyApi,
  input: ContributionPolicyInput,
) {
  const policy = await walletApi.createPolicy(buildContributionPolicy(input));
  return policy;
}