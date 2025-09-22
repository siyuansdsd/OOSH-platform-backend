import jwt from "jsonwebtoken";
import type { Secret, SignOptions } from "jsonwebtoken";

const SECRET = (process.env.JWT_SECRET || "dev-secret") as Secret;
const EXPIRES_IN = process.env.JWT_EXPIRES_IN || "15m";

export function signToken(payload: string | object) {
  const opts: SignOptions = { expiresIn: EXPIRES_IN as any };
  return jwt.sign(payload as any, SECRET, opts);
}

export function verifyToken(token: string) {
  try {
    return jwt.verify(token, SECRET) as any;
  } catch (e) {
    return null;
  }
}
