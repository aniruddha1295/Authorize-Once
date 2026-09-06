import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";

export type AuthorizationStatus = "active" | "revoked" | "expired";
export type ContributionStatus = "claimed" | "contributed" | "skipped" | "failed";
export type ContributionReason =
  | "authorization_revoked"
  | "authorization_expired"
  | "no_authorization"
  | `existing_outcome_${ContributionStatus}`;

export interface MemberRecord {
  memberId: string;
  walletAddress: string;
  joinedAt: string;
}

export interface AuthorizationRecord {
  memberId: string;
  walletAddress: string;
  chainType: string;
  status: AuthorizationStatus;
  grantedAt: string;
  expiresAt: string;
  revokedAt: string | null;
}

export interface ContributionRecord {
  id: string;
  memberId: string;
  period: string;
  status: ContributionStatus;
  reason: string | null;
  txHash: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Membership {
  member: MemberRecord;
  authorization: AuthorizationRecord;
}

export interface ClaimResult {
  claimed: boolean;
  existed: boolean;
  record?: ContributionRecord;
}

export interface CircleStore {
  ensureMember(memberId: string, walletAddress: string, now: string): MemberRecord;
  getMember(memberId: string): MemberRecord | undefined;
  setAuthorization(
    memberId: string,
    walletAddress: string,
    chainType: string,
    ttlSeconds: number,
    grantedAt: string,
  ): AuthorizationRecord;
  getAuthorization(memberId: string): AuthorizationRecord | undefined;
  revokeAuthorization(memberId: string, now: string): AuthorizationRecord | undefined;
  markExpired(now: string): number;
  isAuthorizationActive(memberId: string, now: string): boolean;
  listMemberships(): Membership[];
  claimContribution(memberId: string, period: string, now: string): ClaimResult;
  markContributed(memberId: string, period: string, txHash: string, now: string): ContributionRecord | undefined;
  markFailed(memberId: string, period: string, reason: string, now: string): ContributionRecord | undefined;
  markSkipped(memberId: string, period: string, reason: ContributionReason, now: string): ContributionRecord | undefined;
  getContribution(memberId: string, period: string): ContributionRecord | undefined;
  getContributions(memberId: string): ContributionRecord[];
  close(): void;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS members (
  member_id TEXT PRIMARY KEY,
  wallet_address TEXT NOT NULL,
  joined_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS authorizations (
  member_id TEXT PRIMARY KEY REFERENCES members(member_id),
  wallet_address TEXT NOT NULL,
  chain_type TEXT NOT NULL DEFAULT 'ethereum',
  status TEXT NOT NULL CHECK (status IN ('active','revoked','expired')),
  granted_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT
);
CREATE TABLE IF NOT EXISTS contributions (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES members(member_id),
  period TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('claimed','contributed','skipped','failed')),
  reason TEXT,
  tx_hash TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (member_id, period)
);
`;

interface MemberRow {
  member_id: string;
  wallet_address: string;
  joined_at: string;
}

interface AuthorizationRow {
  member_id: string;
  wallet_address: string;
  chain_type: string;
  status: AuthorizationStatus;
  granted_at: string;
  expires_at: string;
  revoked_at: string | null;
}

interface ContributionRow {
  id: string;
  member_id: string;
  period: string;
  status: ContributionStatus;
  reason: string | null;
  tx_hash: string | null;
  created_at: string;
  updated_at: string;
}

function toMember(row: MemberRow): MemberRecord {
  return { memberId: row.member_id, walletAddress: row.wallet_address, joinedAt: row.joined_at };
}

function toAuthorization(row: AuthorizationRow): AuthorizationRecord {
  return {
    memberId: row.member_id,
    walletAddress: row.wallet_address,
    chainType: row.chain_type,
    status: row.status,
    grantedAt: row.granted_at,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
  };
}

function toContribution(row: ContributionRow): ContributionRecord {
  return {
    id: row.id,
    memberId: row.member_id,
    period: row.period,
    status: row.status,
    reason: row.reason,
    txHash: row.tx_hash,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function isUniqueViolation(err: unknown): boolean {
  if (err && typeof err === "object" && "code" in err) {
    return (err as { code: string }).code === "SQLITE_CONSTRAINT_UNIQUE";
  }
  return false;
}

export function createCircleStore(dbPath: string): CircleStore {
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.exec(SCHEMA);

  const upsertMemberStmt = db.prepare(`
    INSERT INTO members (member_id, wallet_address, joined_at) VALUES (@memberId, @walletAddress, @now)
    ON CONFLICT(member_id) DO UPDATE SET wallet_address = @walletAddress
  `);
  const getMemberStmt = db.prepare("SELECT * FROM members WHERE member_id = ?");
  const authorizeStmt = db.prepare(`
    INSERT INTO authorizations (member_id, wallet_address, chain_type, status, granted_at, expires_at)
    VALUES (@memberId, @walletAddress, @chainType, 'active', @grantedAt, @expiresAt)
    ON CONFLICT(member_id) DO UPDATE SET
      wallet_address = @walletAddress,
      chain_type = @chainType,
      status = 'active',
      granted_at = @grantedAt,
      expires_at = @expiresAt,
      revoked_at = NULL
  `);
  const getAuthorizationStmt = db.prepare(
    "SELECT * FROM authorizations WHERE member_id = ?",
  );
  const revokeStmt = db.prepare(`
    UPDATE authorizations
    SET status = 'revoked', revoked_at = @now
    WHERE member_id = @memberId AND status != 'revoked'
  `);
  const expireStmt = db.prepare(`
    UPDATE authorizations
    SET status = 'expired', revoked_at = COALESCE(revoked_at, @now)
    WHERE status = 'active' AND expires_at <= @now
  `);
  const membershipsStmt = db.prepare(`
    SELECT m.member_id, m.wallet_address, m.joined_at,
           a.chain_type, a.status, a.granted_at, a.expires_at, a.revoked_at
    FROM members m
    JOIN authorizations a ON a.member_id = m.member_id
    ORDER BY m.joined_at ASC
  `);
  const claimStmt = db.prepare(`
    INSERT INTO contributions (id, member_id, period, status, created_at, updated_at)
    VALUES (@id, @memberId, @period, 'claimed', @now, @now)
  `);
  const getContributionStmt = db.prepare(
    "SELECT * FROM contributions WHERE member_id = ? AND period = ?",
  );
  const contributeStmt = db.prepare(`
    UPDATE contributions
    SET status = 'contributed', tx_hash = @txHash, reason = NULL, updated_at = @now
    WHERE member_id = @memberId AND period = @period AND status = 'claimed'
  `);
  const failStmt = db.prepare(`
    UPDATE contributions
    SET status = 'failed', reason = @reason, updated_at = @now
    WHERE member_id = @memberId AND period = @period AND status = 'claimed'
  `);
  const skipStmt = db.prepare(`
    INSERT INTO contributions (id, member_id, period, status, reason, created_at, updated_at)
    VALUES (@id, @memberId, @period, 'skipped', @reason, @now, @now)
    ON CONFLICT(member_id, period) DO UPDATE SET
      status = 'skipped',
      reason = @reason,
      updated_at = @now
    WHERE contributions.status = 'claimed'
  `);
  const listStmt = db.prepare(
    "SELECT * FROM contributions WHERE member_id = ? ORDER BY period DESC",
  );

  function getMemberRow(memberId: string): MemberRow | undefined {
    return getMemberStmt.get(memberId) as MemberRow | undefined;
  }

  function getAuthorizationRow(memberId: string): AuthorizationRow | undefined {
    return getAuthorizationStmt.get(memberId) as AuthorizationRow | undefined;
  }

  function getContributionRow(memberId: string, period: string): ContributionRow | undefined {
    return getContributionStmt.get(memberId, period) as ContributionRow | undefined;
  }

  function insertSkipped(
    memberId: string,
    period: string,
    reason: ContributionReason,
    now: string,
  ): ContributionRecord | undefined {
    try {
      skipStmt.run({ id: randomUUID(), memberId, period, reason, now });
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
    }
    return toContribution(getContributionRow(memberId, period)!);
  }

  return {
    ensureMember(memberId, walletAddress, now): MemberRecord {
      upsertMemberStmt.run({ memberId, walletAddress, now });
      return toMember(getMemberRow(memberId)!);
    },

    getMember(memberId): MemberRecord | undefined {
      const row = getMemberRow(memberId);
      return row ? toMember(row) : undefined;
    },

    setAuthorization(memberId, walletAddress, chainType, ttlSeconds, grantedAt): AuthorizationRecord {
      const granted = new Date(grantedAt);
      const expires = new Date(granted.getTime() + ttlSeconds * 1000);
      authorizeStmt.run({
        memberId,
        walletAddress,
        chainType,
        grantedAt,
        expiresAt: expires.toISOString(),
      });
      return toAuthorization(getAuthorizationRow(memberId)!);
    },

    getAuthorization(memberId): AuthorizationRecord | undefined {
      const row = getAuthorizationRow(memberId);
      return row ? toAuthorization(row) : undefined;
    },

    revokeAuthorization(memberId, now): AuthorizationRecord | undefined {
      const row = getAuthorizationRow(memberId);
      if (!row || row.status === "revoked") return undefined;
      revokeStmt.run({ memberId, now });
      const updated = getAuthorizationRow(memberId);
      return updated ? toAuthorization(updated) : undefined;
    },

    markExpired(now): number {
      const result = expireStmt.run({ now });
      return result.changes;
    },

    isAuthorizationActive(memberId, now): boolean {
      const row = getAuthorizationRow(memberId);
      return Boolean(row && row.status === "active" && row.expires_at > now);
    },

    listMemberships(): Membership[] {
      const rows = membershipsStmt.all() as Array<MemberRow & Omit<AuthorizationRow, "member_id" | "wallet_address">>;
      return rows.map((row) => ({
        member: {
          memberId: row.member_id,
          walletAddress: row.wallet_address,
          joinedAt: row.joined_at,
        },
        authorization: {
          memberId: row.member_id,
          walletAddress: row.wallet_address,
          chainType: row.chain_type,
          status: row.status,
          grantedAt: row.granted_at,
          expiresAt: row.expires_at,
          revokedAt: row.revoked_at,
        },
      }));
    },

    claimContribution(memberId, period, now): ClaimResult {
      const existing = getContributionRow(memberId, period);
      if (existing) {
        return { claimed: false, existed: true, record: toContribution(existing) };
      }
      try {
        claimStmt.run({ id: randomUUID(), memberId, period, now });
      } catch (err) {
        if (isUniqueViolation(err)) {
          return { claimed: false, existed: true, record: toContribution(getContributionRow(memberId, period)!) };
        }
        throw err;
      }
      return { claimed: true, existed: false, record: toContribution(getContributionRow(memberId, period)!) };
    },

    markContributed(memberId, period, txHash, now): ContributionRecord | undefined {
      contributeStmt.run({ memberId, period, txHash, now });
      const row = getContributionRow(memberId, period);
      return row ? toContribution(row) : undefined;
    },

    markFailed(memberId, period, reason, now): ContributionRecord | undefined {
      failStmt.run({ memberId, period, reason, now });
      const row = getContributionRow(memberId, period);
      return row ? toContribution(row) : undefined;
    },

    markSkipped(memberId, period, reason, now): ContributionRecord | undefined {
      return insertSkipped(memberId, period, reason, now);
    },

    getContribution(memberId, period): ContributionRecord | undefined {
      const row = getContributionRow(memberId, period);
      return row ? toContribution(row) : undefined;
    },

    getContributions(memberId): ContributionRecord[] {
      return (listStmt.all(memberId) as ContributionRow[]).map(toContribution);
    },

    close(): void {
      db.close();
    },
  };
}