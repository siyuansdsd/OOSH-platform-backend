import type { Request, Response, NextFunction } from "express";
import { verifyToken } from "../utils/jwt.js";
import * as userModel from "../models/user.js";

export async function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const h = req.headers.authorization || req.headers.Authorization;
  if (!h || typeof h !== "string")
    return res.status(401).json({ error: "missing authorization" });
  const parts = h.split(" ");
  if (parts.length !== 2 || parts[0] !== "Bearer")
    return res.status(401).json({ error: "invalid authorization" });
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
    return res.status(401).json({ error: "token revoked" });
  // attach payload and user
  (req as any).auth = payload;
  (req as any).authUser = user;
  next();
}

export function requireRole(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const auth = (req as any).auth || {};
    const role = auth.role;
    if (!role) return res.status(403).json({ error: "forbidden" });
    if (roles.includes(role)) return next();
    return res.status(403).json({ error: "forbidden" });
  };
}
