import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Source-like files AND committed operational files (e.g. the crontab) must
// never carry a live credential. `.env*` are covered explicitly below.
const EXTENSIONS = [".ts", ".tsx", ".mts", ".css", ".md", ".json", ".crontab"];

const HEX64 = /\b[0-9a-fA-F]{64}\b/u;
const HEX128 = /\b[0-9a-fA-F]{128}\b/u;
const SK_TOKEN = /\bsk-[A-Za-z0-9]{20,}/u;

function trackedCandidates(): string[] {
  const root = process.cwd();
  const skip = new Set(["node_modules", ".next", "data", ".git"]);
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!skip.has(entry.name)) walk(path.join(dir, entry.name));
      } else if (path.basename(entry.name).startsWith(".env") || EXTENSIONS.includes(path.extname(entry.name))) {
        out.push(path.join(dir, entry.name));
      }
    }
  };
  walk(root);
  return out;
}

function hitsFor(pattern: RegExp): Array<{ file: string; line: number }> {
  const hits: Array<{ file: string; line: number }> = [];
  for (const file of trackedCandidates()) {
    const content = readFileSync(file, "utf8");
    for (const [index, line] of content.split("\n").entries()) {
      if (pattern.test(line)) hits.push({ file: path.relative(process.cwd(), file), line: index + 1 });
    }
  }
  return hits;
}

describe("P9-9/1 — secret hygiene", () => {
  it("does not contain 64- or 128-character hex literals in tracked source files", () => {
    expect(hitsFor(HEX64)).toEqual([]);
    expect(hitsFor(HEX128)).toEqual([]);
  });

  it("does not contain Privy secret tokens (sk-…) in tracked source files", () => {
    expect(hitsFor(SK_TOKEN)).toEqual([]);
  });

  it("gitignores .env files", () => {
    const gitignore = readFileSync(path.join(process.cwd(), ".gitignore"), "utf8");
    const lines = gitignore.split("\n").map((l) => l.trim()).filter(Boolean);
    expect(lines).toContain(".env");
    expect(lines).toContain(".env.*");
  });

  it("keeps secret placeholders out of .env.example", () => {
    const example = readFileSync(path.join(process.cwd(), ".env.example"), "utf8");
    expect(example).toContain("PRIVY_AUTHORIZATION_PRIVATE_KEY=");
    expect(example).not.toMatch(/^PRIVY_APP_SECRET=.{10,}/m);
    expect(example).not.toMatch(SK_TOKEN);
  });
});