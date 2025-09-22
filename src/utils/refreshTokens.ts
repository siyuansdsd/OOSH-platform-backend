import crypto from "crypto";
import type { UserItem } from "../models/user.js";
import { updateUser, getUserById } from "../models/user.js";

const DEFAULT_TTL_DAYS = Number(process.env.REFRESH_TOKEN_TTL_DAYS || 30);
const REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET;

function hash(value: string) {
  return crypto.createHash("sha256").update(value + (REFRESH_SECRET || ""), "utf8").digest("hex");
}

export function generateRefreshToken(userId: string) {
  const random = crypto.randomBytes(48).toString("hex");
  const token = `${userId}.${random}`;
  const tokenHash = hash(token);
  const expiresAt = new Date(Date.now() + DEFAULT_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();
  return { token, tokenHash, expiresAt };
}

export function parseRefreshToken(raw: string) {
  if (!raw) return null;
  const parts = raw.split(".");
  if (parts.length < 2) return null;
  const userId = parts.shift();
  const remainder = parts.join(".");
  if (!userId || !remainder) return null;
  return { userId, tokenHash: hash(`${userId}.${remainder}`) };
}

export function isRefreshExpired(user: UserItem) {
  if (!user.refresh_token_expires_at) return true;
  return new Date(user.refresh_token_expires_at).getTime() <= Date.now();
}

export async function clearRefreshToken(userId: string) {
  const user = await getUserById(userId);
  if (!user) return;
  await updateUser(userId, {
    refresh_token_hash: null,
    refresh_token_expires_at: null,
  });
}
