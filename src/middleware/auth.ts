import type { Request, Response, NextFunction } from "express";
import { verifyToken } from "../utils/jwt.js";
import * as userModel from "../models/user.js";

function maskToken(t: string) {
  if (!t) return "";
  if (t.length <= 10) return t.replace(/.(?=.{2})/g, "*");
  return `${t.slice(0, 6)}...${t.slice(-4)}`;
}

function logAuthFailure(
  req: Request,
  reason: string,
  extras: Record<string, any> = {}
) {
  const info = {
    ts: new Date().toISOString(),
    method: req.method,
    path: req.originalUrl || req.url,
    ip: req.ip || req.headers["x-forwarded-for"] || req.socket?.remoteAddress,
    ua: req.headers["user-agent"] || null,
    reason,
    ...extras,
  };
  // keep logs concise but structured
  console.warn("[auth] failure", JSON.stringify(info));
}

export async function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const h = req.headers.authorization || req.headers.Authorization;
  if (!h || typeof h !== "string")
    return (
      logAuthFailure(req, "missing authorization"),
      res.status(401).json({ error: "missing authorization" })
    );
  const parts = h.split(" ");
  if (parts.length !== 2 || parts[0] !== "Bearer")
    return (
      logAuthFailure(req, "invalid authorization", {
        header: String(h).slice(0, 50),
      }),
      res.status(401).json({ error: "invalid authorization" })
    );
  const token = parts[1] || "";
  const payload = verifyToken(token);
  if (!payload) return res.status(401).json({ error: "invalid token" });
  // verify token_version matches user's current token_version
  const userId = (payload as any).id;
  if (!userId) return res.status(401).json({ error: "invalid token payload" });
  const user = await userModel.getUserById(String(userId));
  if (!user) return res.status(401).json({ error: "user not found" });
  const tokenVersion = (payload as any).token_version || 0;
  if ((user.token_version || 0) !== tokenVersion)
    return (
      logAuthFailure(req, "token_revoked", {
        userId: String(userId),
        token: maskToken(token),
      }),
      res.status(401).json({ error: "token revoked" })
    );
  // attach payload and user
  (req as any).auth = payload;
  (req as any).authUser = user;
  next();
}

export function requireRole(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const auth = (req as any).auth || {};
    const authUser = (req as any).authUser;
    const role = (authUser && authUser.role) || auth.role;
    if (!role) {
      logAuthFailure(req, "missing_role", { user: authUser?.id || null });
      return res.status(403).json({ error: "forbidden" });
    }
    if (roles.includes(role)) return next();
    logAuthFailure(req, "insufficient_role", {
      required: roles,
      actual: role,
      user: authUser?.id || null,
    });
    return res.status(403).json({ error: "forbidden" });
  };
}
