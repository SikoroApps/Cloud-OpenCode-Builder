import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import * as db from "./db.ts";

function hashPassword(password: string, salt: string): string {
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password: string, stored: string): boolean {
  const separator = stored.indexOf(":");
  if (separator < 0) return false;
  const salt = stored.slice(0, separator);
  const expected = stored.slice(separator + 1);
  const actual = scryptSync(password, salt, 64).toString("hex");
  const a = Buffer.from(actual, "hex");
  const b = Buffer.from(expected, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

export function createUserSession(userId: string, now: number): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString("hex");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  db.insertSession(tokenHash, userId, now, now + 30 * 24 * 60 * 60 * 1000);
  return { token, tokenHash };
}

export function resolveUserByToken(token: string, now: number): string | null {
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const session = db.findSessionByHash(tokenHash);
  if (!session) return null;
  const user = db.findUserById(String(session.user_id)) as any;
  if (!user) return null;
  return String(user.id);
}

export { hashPassword, verifyPassword, randomUUID };
