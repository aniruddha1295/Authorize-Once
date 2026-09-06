"use client";
import type { ReactNode } from "react";
import { PrivyProvider } from "@privy-io/react-auth";
import { baseSepolia } from "viem/chains";

export const PRIVY_CONFIG = {
  defaultChain: baseSepolia,
  supportedChains: [baseSepolia],
  embeddedWallets: {
    ethereum: { createOnLogin: "users-without-wallets" as const },
  },
};

export function Providers({ children }: { children: ReactNode }) {
  return (
    <PrivyProvider appId={process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? ""} config={PRIVY_CONFIG}>
      {children}
    </PrivyProvider>
  );
}