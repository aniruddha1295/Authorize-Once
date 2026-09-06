# RTD-P9 (reference clone) — Authorize Once, Then Stop Asking

*"Authorize Once, Then Stop Asking" — Road to Devcon III, Build Battle Week 3, PS 3.*

A savings-circle backend built around Privy's **delegated-actions** grant: a member approves
once in the join flow, and a scheduled job then makes their weekly contribution while they're
offline, supposedly under a policy-enforced contract allowlist, value cap, and expiry. Cloned
from `github.com/Niru-9/road-to-DEVCON-P9` for comparison against our own PS 3 repo, then
verified line-by-line and by actually running its test/build pipeline rather than trusting its
README's self-graded table.

> This is a third-party submission, not ours. Kept at `week 3/reference-road-to-DEVCON-P9/` for
> reference only — it retains its own git history and is not one of our three Week 3 repos.

## Grant lifecycle (as built)

```
Member:  delegateWallet(address, chainType)  ──▶  Privy delegated-actions grant
              │                                    (unscoped: no policyId, no expiry passed)
              ▼
     POST /api/join  ──▶  app DB row: authorizations.expires_at = now + 90d
              │
     [ weekly, unattended ]
              ▼
Scheduler:  markExpired(now)  ──▶  flips app-DB rows past expires_at to 'expired'
              │
     for each member:  claimContribution(member, period)   (UNIQUE(member_id, period))
              │
      claim wins ──▶  walletApi.ethereum.sendTransaction({ address, to, value })
              │            (no policyId attached to this call, anywhere)
              ▼
      success ──▶ markContributed     failure ──▶ markFailed(reason)     skip ──▶ markSkipped(reason)

Member:  revokeWallets()  +  POST /api/revoke  ──▶  app DB row: status = 'revoked'
                                                     (Privy-side grant is separately revoked too)
```

The two lines marked above are the defect: `policies/contribution-policy.ts` builds a real
allowlist-plus-cap rule, and `lib/policy.ts` can push it to Privy via `createPolicy(...)` — but
nothing in the codebase ever attaches that policy's id to the wallet, the delegation, or the
`sendTransaction` call. It exists in Privy as a standalone object with nothing bound to it.

## Against the scored checks

| # | Check | Verified status | Evidence |
|---|-------|------------------|----------|
| 1 | Client requests wallet access through the SDK's grant flow | **PASS** | `useDelegatedActions().delegateWallet({ address, chainType: "ethereum" })`, called from *Authorize once & join* in `components/CircleDashboard.tsx`. |
| 2 | Committed policy allowlists the contribution contract | **FAIL (in substance)** | `buildContributionPolicy` writes a real `to IN [contractAddress]` rule, but `lib/contributor.ts:submitContribution` calls `sendTransaction` with no `policyIds` field, and no wallet-update call anywhere attaches one. Grepped the tree for `policyId`/`policyIds`/`attachPolicy`/`updateWallet`: zero matches. |
| 3 | Committed policy caps the value a signer may move | **FAIL (in substance)** | Same unattached-policy object carries the `value LTE weeklyCapWei` rule — same defect as check 2. |
| 4 | The grant carries an expiry | **FAIL** | Upstream's own README admits it: *"the Privy policy object itself carries no expiry field."* `authorizations.expires_at` is an app-DB column the scheduler consults before deciding to call Privy — not a bound on the grant itself. A bug in the scheduler, or a direct Wallet API call with the authorization key, is not stopped by anything on Privy's side. |
| 5 | Server signs wallet requests with an authorization key | **PASS** | `PrivyClient(appId, appSecret, { walletApi: { authorizationPrivateKey: cfg.authorizationPrivateKey } })` in `lib/auth.ts`, sourced from `process.env` at call time, constructed only server-side. |
| 6 | Recurring job refuses a second contribution for the same period | **PASS** | `contributions` table: `UNIQUE(member_id, period)`. `lib/scheduler.ts` claims a row before signing; a re-run (even after a mid-run crash leaving a `claimed` row) resolves to a durable skip, never a second send. |
| 7 | A user-reachable control revokes the grant | **PASS** | A real *Revoke authorization* button in `components/CircleDashboard.tsx` calling `revokeWallets()` + `POST /api/revoke`. |
| 8 | Revoked/expired signer resolves to a defined server outcome | **PASS** | `lib/scheduler.ts` checks authorization status before calling the signer and records `skipped (reason)`; genuine signer rejections are caught, classified (`classifyContributionError`), and recorded — the batch loop continues to the next member either way. |
| 9 | No credential in any tracked file | **PASS** | `.gitignore` excludes `.env`/`.env.*` from the first commit; grepped all 3 commits and every tracked file — only placeholder strings in test fixtures (`"sec-1"`, `"sk-key-1"`), no real key. |

Checks 2 and 3 would likely still score on an automated pattern-match (the policy object is
genuinely committed, well-formed code), but functionally they don't do what the check exists to
verify: a policy that constrains this specific grant. Check 4 fails outright against its own
stated fail condition.

## Verification findings

We didn't just read the code — we ran it, against a real clean-clone attempt:

- **`npm test` fails 1/44 on a genuine `git clone`.** The repo's `.gitignore` uses the blanket
  `.env.*` pattern, which also excludes `.env.example` from being tracked, so
  `tests/secret-scan.test.ts` (which asserts `.env.example` exists on disk) fails on a fresh
  clone. The upstream README's "44/44 tests green" claim is not reproducible as shipped. We
  authored `.env.example` ourselves, from the README's own variable table, to get to 44/44 — see
  [Reproduction](#reproduction) below.
- **The policy-attachment gap (checks 2–4)** — see the lifecycle diagram and table above. This is
  the load-bearing finding: the architecture is built on Privy's `delegated-actions` API, which
  has no per-call attachment point for a policy anywhere used in this code. The problem's own
  knowledge-graph notes (`road-to-devcon-week3.md`, PS 3 section) point at Privy **session
  signers with an attached override policy** as the intended primitive — a model where the
  policy rides on the signer and Privy enforces it regardless of what the app's code does. This
  repo's `delegated-actions` grant carries no such attachment, so the challenge's central lesson
  ("limits that hold even if your own code is wrong") isn't actually demonstrated.

## What's genuinely solid

- **Idempotency (check 6)** — real SQLite `UNIQUE(member_id, period)` plus claim-before-send in
  `lib/scheduler.ts`; a crash between claim and submit resolves to a durable
  `skipped (existing_outcome_claimed)`, never a double-send.
- **Per-member failure isolation (check 8)** — every member wrapped in its own `try/catch`; one
  rejection never aborts the batch.
- **Secrets hygiene (check 9)** — `.gitignore` committed before any code reads a secret, no real
  key anywhere across history, authorization key only ever constructed server-side.
- **Revoke control (check 7)** — a real product-UI button, not a script.

## Reproduction

```shell
git clone https://github.com/Niru-9/road-to-DEVCON-P9.git
cd road-to-DEVCON-P9
npm install
npm test            # fails 1/44 — missing .env.example (see Verification findings)
```

`.env.example`, reconstructed from the upstream README's variable table (not shipped upstream):

```
PRIVY_APP_ID=
PRIVY_APP_SECRET=
NEXT_PUBLIC_PRIVY_APP_ID=
PRIVY_AUTHORIZATION_PRIVATE_KEY=
CONTRIBUTION_CONTRACT_ADDRESS=
WEEKLY_CONTRIBUTION_CAP_WEI=10000000000000000
AUTHORIZATION_TTL_SECONDS=7776000
CAIP2_CHAIN=eip155:84532
NEXT_PUBLIC_CIRCLE_NAME=
DB_PATH=data/circle.db
```

With that file added:

```shell
npm test            # 44/44 pass
npm run typecheck   # tsc --noEmit, clean
npm run build       # succeeds — one harmless warning for an unresolved optional peer
                     # (@farcaster/mini-app-solana) inside @privy-io/react-auth's bundle
```

Actual captured output:

```
 Test Files  8 passed (8)
      Tests  44 passed (44)
   Duration  2.50s
```

`CONTRIBUTION_CONTRACT_ADDRESS` must be a real deployed address — the policy builder
(`assertContributionPolicyInput`) throws on the zero placeholder, so `--create-policy` cannot run
without one. No live Privy/Base Sepolia round was ever run by the original author; all 44 tests
exercise a fake `ContributionSigner`, never the real Wallet API.

## Project layout

```
policies/contribution-policy.ts   allowlist + cap rules (never attached to any grant)
lib/policy.ts                     pushes the policy object to Privy (manual operator script only)
lib/auth.ts                       PrivyClient with env-loaded authorization key
lib/contributor.ts                the actual eth_sendTransaction call (no policyId passed)
lib/scheduler.ts                  claim-then-send weekly round, per-member try/catch
lib/store.ts                      SQLite, UNIQUE(member_id, period)
app/api/join/route.ts             durable membership + app-level expiry row (not grant-level)
app/api/revoke/route.ts           flips authorization status to revoked
components/CircleDashboard.tsx    join / revoke UI, delegateWallet / revokeWallets calls
scripts/check-server-auth.ts      operator script: env check + optional manual policy push
scheduling/*.crontab              weekly cron entry for scripts/run-scheduler.ts
tests/                            8 files, 44 tests (unit + component + security)
```
