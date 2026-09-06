// @vitest-environment jsdom
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CircleDashboard } from "@/components/CircleDashboard";
import { CircleShell } from "@/components/CircleShell";
import { InitializingScreen } from "@/components/InitializingScreen";
import { LoginScreen } from "@/components/LoginScreen";

const privyMock = vi.hoisted(() => ({
  usePrivy: vi.fn(),
  useWallets: vi.fn(),
  useDelegatedActions: vi.fn(),
  getEmbeddedConnectedWallet: vi.fn(),
  PrivyProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("@privy-io/react-auth", () => privyMock);

const CONTRACT = "0x" + "ab".repeat(20);
const MEMBER_WALLET = "0x" + "cd".repeat(20);

function circle() {
  return {
    name: "Sunday Savings Circle",
    weeklyCapEth: "0.01",
    weeklyCapWei: "10000000000000000",
    contractAddress: CONTRACT,
    authorizationTtlDays: 90,
    caip2Chain: "eip155:84532",
    policy: {
      name: "contribution-circle-weekly",
      version: "1.0",
      chainType: "ethereum",
      rules: [
        {
          name: "allow-weekly-contribution",
          action: "ALLOW",
          method: "eth_sendTransaction",
          conditions: [
            { fieldSource: "ethereum_transaction", field: "to", operator: "in", value: [CONTRACT] },
            { fieldSource: "ethereum_transaction", field: "value", operator: "lte", value: "10000000000000000" },
          ],
        },
        { name: "deny-everything-else", action: "DENY", method: "*", conditions: [] },
      ],
    },
  };
}

interface AuthState {
  status: "active" | "revoked";
  memberId: string;
  walletAddress: string;
  chainType: string;
  grantedAt: string;
  expiresAt: string;
  revokedAt: string | null;
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function makeFetchStub() {
  const state = {
    authorization: null as AuthState | null,
    contributions: [] as unknown[],
    member: null as unknown,
  };
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    if (method === "GET" && url.endsWith("/api/me")) {
      return jsonResponse({
        member: state.member,
        authorization: state.authorization,
        contributions: state.contributions,
        circle: circle(),
      });
    }
    if (method === "POST" && url.endsWith("/api/join")) {
      const body = JSON.parse(String(init?.body)) as { walletAddress: string };
      state.member = { memberId: "user-1", walletAddress: body.walletAddress, joinedAt: new Date().toISOString() };
      state.authorization = {
        memberId: "user-1",
        walletAddress: body.walletAddress,
        chainType: "ethereum",
        status: "active",
        grantedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 7_776_000_000).toISOString(),
        revokedAt: null,
      };
      return jsonResponse({ member: state.member, authorization: state.authorization, circle: circle() });
    }
    if (method === "POST" && url.endsWith("/api/revoke")) {
      state.authorization = {
        memberId: "user-1",
        walletAddress: (state.member as { walletAddress: string }).walletAddress,
        chainType: "ethereum",
        status: "revoked",
        grantedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 7_776_000_000).toISOString(),
        revokedAt: new Date().toISOString(),
      };
      return jsonResponse({ authorization: state.authorization });
    }
    return jsonResponse({ error: "not found" }, 404);
  });
  return { fetchMock, state };
}

function mockAuthenticatedPrivy() {
  const delegateWallet = vi.fn().mockResolvedValue(undefined);
  const revokeWallets = vi.fn().mockResolvedValue(undefined);
  privyMock.usePrivy.mockReturnValue({
    ready: true,
    authenticated: true,
    user: { id: "user-1" },
    login: vi.fn(),
    logout: vi.fn(),
    getAccessToken: async () => "test-access-token",
  });
  privyMock.useWallets.mockReturnValue({
    wallets: [{ address: MEMBER_WALLET, chainId: "eip155:84532" }],
  });
  privyMock.getEmbeddedConnectedWallet.mockImplementation((wallets: Array<{ address: string }>) =>
    wallets[0] ?? null,
  );
  privyMock.useDelegatedActions.mockReturnValue({ delegateWallet, revokeWallets });
  return { delegateWallet, revokeWallets };
}

beforeEach(() => {
  privyMock.usePrivy.mockReset();
  privyMock.useWallets.mockReset();
  privyMock.getEmbeddedConnectedWallet.mockReset();
  privyMock.useDelegatedActions.mockReset();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("P9-1 — the one-time grant from the product UI", () => {
  it("shows the login and initializing gates", async () => {
    privyMock.usePrivy.mockReturnValue({ ready: true, authenticated: false, login: vi.fn(), logout: vi.fn() });
    const { container } = render(<CircleShell />);
    expect(container.querySelector('[data-testid="login-screen"]')).toBeTruthy();
    cleanup();

    privyMock.usePrivy.mockReturnValue({ ready: false, authenticated: false, login: vi.fn(), logout: vi.fn() });
    const loading = render(<CircleShell />);
    expect(loading.container.querySelector('[data-testid="initializing"]')).toBeTruthy();
  });

  it("offers sign-in with only the supported methods", () => {
    const login = vi.fn();
    privyMock.usePrivy.mockReturnValue({ ready: true, authenticated: false, login, logout: vi.fn() });
    render(<LoginScreen />);
    fireEvent.click(screen.getByTestId("signin-button"));
    expect(login).toHaveBeenCalledWith({ loginMethods: ["google", "email"] });
  });

  it("delegates the embedded wallet and joins (P9-1 P9-4), then revokes (P9-7)", async () => {
    const { delegateWallet, revokeWallets } = mockAuthenticatedPrivy();
    const { fetchMock, state } = makeFetchStub();
    vi.stubGlobal("fetch", fetchMock);

    render(<CircleDashboard />);

    const joinButton = await screen.findByTestId("join-button");
    fireEvent.click(joinButton);

    await waitFor(() => expect(delegateWallet).toHaveBeenCalledWith({
      address: MEMBER_WALLET,
      chainType: "ethereum",
    }));

    await waitFor(() => {
      expect(screen.getByTestId("authorization-status").textContent).toBe("active");
      expect(state.authorization?.status).toBe("active");
    });

    expect(screen.getByTestId("embedded-wallet-address").textContent).toBe(MEMBER_WALLET);
    expect(screen.getByTestId("circle-ttl").textContent).toContain("0.01 ETH/week");
    expect(screen.getByTestId("policy-rules").textContent).toContain("ALLOW eth_sendTransaction");
    expect(screen.getByTestId("no-contributions")).toBeTruthy();
    expect(screen.queryByTestId("join-button")).toBeNull(); // joined — no join button

    fireEvent.click(screen.getByTestId("revoke-button"));

    await waitFor(() => expect(revokeWallets).toHaveBeenCalled());
    await waitFor(() => {
      expect(screen.getByTestId("authorization-status").textContent).toBe("revoked");
    });
    expect(screen.getByTestId("rejoin-button")).toBeTruthy();
  });

  it("disables authorization while the wallet is still being created", async () => {
    mockAuthenticatedPrivy();
    privyMock.getEmbeddedConnectedWallet.mockReturnValue(null);
    const { fetchMock } = makeFetchStub();
    vi.stubGlobal("fetch", fetchMock);

    render(<CircleDashboard />);
    const joinButton = await screen.findByTestId("join-button");
    expect(screen.getByTestId("embedded-wallet-status").textContent).toContain("Creating your wallet");
    expect((joinButton as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("P9-2/P9-3 — committed scope rendered to the member", () => {
  it("shows the policy allow rule with the contract allowlist and the cap", async () => {
    mockAuthenticatedPrivy();
    const { fetchMock } = makeFetchStub();
    vi.stubGlobal("fetch", fetchMock);
    render(<CircleDashboard />);
    const rules = await screen.findByTestId("policy-rules");
    expect(rules.textContent).toContain("ALLOW eth_sendTransaction");
    expect(rules.textContent).toContain("to in");
    expect(rules.textContent).toContain("value lte");
  });
});

describe("InitializingScreen", () => {
  it("renders without crashing", () => {
    const { container } = render(<InitializingScreen />);
    expect(container.querySelector('[data-testid="initializing"]')).toBeTruthy();
  });
});