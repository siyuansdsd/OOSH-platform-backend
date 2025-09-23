import type { Request, Response } from "express";
import * as userModel from "../models/user.js";
import { signToken } from "../utils/jwt.js";
import { recordFailedAttempt, resetFailedAttempts } from "../utils/authAttempts.js";
import { redisGet, redisDel } from "../utils/redisClient.js";
import {
  generateRefreshToken,
  parseRefreshToken,
  isRefreshExpired,
} from "../utils/refreshTokens.js";
import bcrypt from "bcryptjs";

const SALT_ROUNDS = 10;

export async function register(req: Request, res: Response) {
  const { username, password, display_name, email, role } = req.body || {};
  if (!username)
    return res.status(400).json({ error: "username required" });
  // only allow creating Editor or User or StudentPublic via this endpoint
  const allowedRoles = ["Editor", "User", "StudentPublic"];
  const finalRole = allowedRoles.includes(role) ? role : "User";

  if (finalRole !== "User" && !password)
    return res.status(400).json({ error: "password required for this role" });

  // check existing
  const existing = await userModel.getUserByUsername(username);
  if (existing) return res.status(409).json({ error: "username exists" });

  const patch: any = {
    username,
    display_name,
    email,
    role: finalRole,
  };
  if (password) {
    patch.password_hash = await bcrypt.hash(password, SALT_ROUNDS);
  }
  const u = await userModel.createUser(patch);
  // do not return password hash
  delete (u as any).password_hash;
  res.status(201).json(u);
}

// admin can create any role (including Admin)
export async function adminCreate(req: Request, res: Response) {
  const { username, password, display_name, email, role, blocked } =
    req.body || {};
  if (!username || !password)
    return res.status(400).json({ error: "username and password required" });
  const existing = await userModel.getUserByUsername(username);
  if (existing) return res.status(409).json({ error: "username exists" });
  const hash = await bcrypt.hash(password, SALT_ROUNDS);
  const u = await userModel.createUser({
    username,
    display_name,
    email,
    password_hash: hash,
    role: role || "User",
    blocked: !!blocked,
  });
  delete (u as any).password_hash;
  res.status(201).json(u);
}

export async function login(req: Request, res: Response) {
  const { username, password, email, code } = req.body || {};

  if (email && code && !username && !password) {
    // email + code login for regular users
    const userByEmail = await userModel.getUserByEmail(String(email));
    if (!userByEmail)
      return res.status(401).json({ error: "invalid credentials" });
    if (userByEmail.blocked)
      return res.status(403).json({ error: "account blocked" });
    if (userByEmail.role !== "User")
      return res.status(403).json({ error: "forbidden" });

    const key = `verify:${email}`;
    const storedCode = await redisGet(key);
    if (!storedCode || storedCode !== code) {
      return res.status(400).json({ error: "invalid code" });
    }
    await redisDel(key);

    await resetFailedAttempts(userByEmail as any);
    return issueTokensForUser(userByEmail, "default", res);
  }

  if (username && password && !code) {
    const user = await userModel.getUserByUsername(username);
    if (!user) return res.status(401).json({ error: "invalid credentials" });
    if (user.blocked) return res.status(403).json({ error: "account blocked" });
    if (user.role !== "StudentPublic")
      return res.status(403).json({ error: "forbidden" });
    const ok = user.password_hash
      ? await bcrypt.compare(password, user.password_hash)
      : false;
    if (!ok)
      return res.status(401).json({ error: "invalid credentials" });

    await resetFailedAttempts(user as any);
    return issueTokensForUser(user, "default", res);
  }

  return res.status(400).json({ error: "unsupported login payload" });
}

async function issueTokensForUser(
  user: any,
  scope: "default" | "admin",
  res: Response
) {
  const accessToken = signToken({
    id: user.id,
    username: user.username,
    role: user.role,
    token_version: user.token_version || 0,
    scope,
  });

  const { token: refreshToken, tokenHash, expiresAt } = generateRefreshToken(
    user.id
  );

  await userModel.updateUser(user.id, {
    last_login: new Date().toISOString(),
    failed_login_attempts: 0,
    last_failed_login_at: null,
    refresh_token_hash: tokenHash,
    refresh_token_expires_at: expiresAt,
  });

  res.json({
    token: accessToken,
    expiresIn: process.env.JWT_EXPIRES_IN || "3d",
    refreshToken,
    refreshTokenExpiresAt: expiresAt,
    user: {
      id: user.id,
      username: user.username,
      role: user.role,
      display_name: user.display_name,
      email: user.email,
      token_version: user.token_version || 0,
      scope,
    },
  });
}

export async function adminLogin(req: Request, res: Response) {
  const { username, password, code } = req.body || {};
  if (!username || !password || !code)
    return res
      .status(400)
      .json({ error: "username, password and code required" });
  const user = await userModel.getUserByUsername(username);
  if (!user)
    return res.status(401).json({ error: "invalid credentials" });
  if (!["Admin", "Editor"].includes(user.role))
    return res.status(403).json({ error: "forbidden" });
  if (user.blocked)
    return res.status(403).json({ error: "account blocked" });

  const ok = user.password_hash
    ? await bcrypt.compare(password, user.password_hash)
    : false;
  if (!ok) {
    await recordFailedAttempt(user as any);
    if (user.blocked)
      return res.status(403).json({ error: "account blocked" });
    return res.status(401).json({ error: "invalid credentials" });
  }

  await resetFailedAttempts(user as any);

  const email = user.email;
  if (!email) return res.status(400).json({ error: "email not configured" });
  const key = `verify:${email}`;
  const storedCode = await redisGet(key);
  if (!storedCode || storedCode !== code) {
    return res.status(400).json({ error: "invalid code" });
  }
  await redisDel(key);

  return issueTokensForUser(user, "admin", res);
}

// Admin: increment token_version to revoke existing tokens for a user
export async function kickUser(req: Request, res: Response) {
  const id = String(req.params.id || "");
  const existing = await userModel.getUserById(id);
  if (!existing) return res.status(404).json({ error: "not found" });
  const next = (existing.token_version || 0) + 1;
  const updated = await userModel.updateUser(id, { token_version: next });
  if (!updated) return res.status(500).json({ error: "failed" });
  delete (updated as any).password_hash;
  res.json({ ok: true, token_version: next });
}

export async function refreshToken(req: Request, res: Response) {
  const { refreshToken, scope } = req.body || {};
  if (!refreshToken)
    return res.status(400).json({ error: "refreshToken required" });
  const parsed = parseRefreshToken(String(refreshToken));
  if (!parsed) return res.status(401).json({ error: "invalid refresh token" });
  const user = (await userModel.getUserById(parsed.userId)) as any;
  if (!user) return res.status(401).json({ error: "invalid refresh token" });
  if (user.blocked)
    return res.status(403).json({ error: "account blocked" });
  if (!user.refresh_token_hash || user.refresh_token_hash !== parsed.tokenHash)
    return res.status(401).json({ error: "invalid refresh token" });
  if (isRefreshExpired(user)) {
    await userModel.updateUser(user.id, {
      refresh_token_hash: null,
      refresh_token_expires_at: null,
    });
    return res.status(401).json({ error: "refresh expired" });
  }

  const desiredScope = scope === "admin" ? "admin" : "default";
  if (desiredScope === "admin" && !["Admin", "Editor"].includes(user.role)) {
    return res.status(403).json({ error: "forbidden" });
  }

  const payload: any = {
    id: user.id,
    username: user.username,
    role: user.role,
    token_version: user.token_version || 0,
    scope: desiredScope,
  };
  const accessToken = signToken(payload);

  const { token: newRefreshToken, tokenHash, expiresAt } = generateRefreshToken(
    user.id
  );

  await userModel.updateUser(user.id, {
    refresh_token_hash: tokenHash,
    refresh_token_expires_at: expiresAt,
  });

  res.json({
    token: accessToken,
    expiresIn: process.env.JWT_EXPIRES_IN || "3d",
    refreshToken: newRefreshToken,
    refreshTokenExpiresAt: expiresAt,
    user: {
      id: user.id,
      username: user.username,
      role: user.role,
      display_name: user.display_name,
      email: user.email,
      token_version: user.token_version || 0,
      scope: desiredScope,
    },
  });
}

export async function logout(req: Request, res: Response) {
  const authUser = (req as any).authUser;
  if (!authUser) return res.status(401).json({ error: "unauthorized" });
  const nextVersion = (authUser.token_version || 0) + 1;
  await userModel.updateUser(authUser.id, {
    refresh_token_hash: null,
    refresh_token_expires_at: null,
    token_version: nextVersion,
  });
  res.json({ ok: true, token_version: nextVersion });
}

export async function updateSelf(req: Request, res: Response) {
  const authUser = (req as any).authUser;
  if (!authUser) return res.status(401).json({ error: "unauthorized" });

  const body = req.body || {};
  // prevent email changes through self-service endpoint
  if (
    Object.prototype.hasOwnProperty.call(body, "email") &&
    body.email !== undefined &&
    body.email !== authUser.email
  ) {
    return res.status(400).json({ error: "email change not allowed" });
  }

  const patch: Record<string, any> = {};
  const allowPassword = authUser.role !== "User";
  if (Object.prototype.hasOwnProperty.call(body, "display_name")) {
    patch.display_name = body.display_name;
  }

  if (typeof body.password === "string" && body.password.length > 0) {
    if (!allowPassword) {
      return res.status(400).json({ error: "password change not allowed" });
    }
    patch.password_hash = await bcrypt.hash(body.password, SALT_ROUNDS);
  }

  if (Object.keys(patch).length === 0) {
    return res.status(400).json({ error: "no permitted fields" });
  }

  const updated = await userModel.updateUser(authUser.id, patch);
  if (!updated) return res.status(404).json({ error: "not found" });
  delete (updated as any).password_hash;
  res.json(updated);
}

export async function list(req: Request, res: Response) {
  const users = await userModel.listUsers(1000);
  // strip password_hash
  const out = users.map((u: any) => ({ ...u, password_hash: undefined }));
  res.json(out);
}

export async function getOne(req: Request, res: Response) {
  const id = String(req.params.id || "");
  const u = await userModel.getUserById(id);
  if (!u) return res.status(404).json({ error: "not found" });
  delete (u as any).password_hash;
  res.json(u);
}

export async function update(req: Request, res: Response) {
  const id = String(req.params.id || "");
  const patch = req.body || {};
  // if password present, hash it
  if (patch.password) {
    patch.password_hash = await bcrypt.hash(patch.password, SALT_ROUNDS);
    delete patch.password;
  }
  const updated = await userModel.updateUser(id, patch);
  if (!updated) return res.status(404).json({ error: "not found" });
  delete (updated as any).password_hash;
  res.json(updated);
}

export async function remove(req: Request, res: Response) {
  const id = String(req.params.id || "");
  await userModel.deleteUser(id);
  res.json({ ok: true });
}

// admin-only: block/unblock user
export async function blockUser(req: Request, res: Response) {
  const id = String(req.params.id || "");
  const { block } = req.body || {};
  const updated = await userModel.updateUser(id, { blocked: !!block });
  if (!updated) return res.status(404).json({ error: "not found" });
  delete (updated as any).password_hash;
  res.json(updated);
}
