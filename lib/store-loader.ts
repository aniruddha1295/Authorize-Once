import fs from "node:fs";
import path from "node:path";
import { createCircleStore, type CircleStore } from "./store";

let cached: CircleStore | null = null;

export function defaultCircleDbPath(): string {
  return path.join(process.cwd(), "data", "circle.db");
}

export function loadCircleStore(): CircleStore {
  if (!cached) {
    const dbPath = process.env.DB_PATH || defaultCircleDbPath();
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    cached = createCircleStore(dbPath);
  }
  return cached;
}

export function resetCircleStore(): void {
  if (!cached) return;
  try {
    cached.close();
  } catch {
    // ignore close errors during teardown
  }
  cached = null;
}