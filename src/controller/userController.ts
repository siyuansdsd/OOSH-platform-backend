import type { Request, Response } from "express";
import * as userModel from "../models/user.js";
import { signToken, verifyToken } from "../utils/jwt.js";
import bcrypt from "bcryptjs";

const SALT_ROUNDS = 10;

export async function register(req: Request, res: Response) {
  const { username, password, display_name, email, role } = req.body || {};
  if (!username || !password)
    return res.status(400).json({ error: "username and password required" });
  // only allow creating Editor or User or StudentPublic via this endpoint
  const allowedRoles = ["Editor", "User", "StudentPublic"];
  const finalRole = allowedRoles.includes(role) ? role : "User";

  // check existing
  const existing = await userModel.getUserByUsername(username);
  if (existing) return res.status(409).json({ error: "username exists" });

  const hash = await bcrypt.hash(password, SALT_ROUNDS);
  const u = await userModel.createUser({
    username,
    display_name,
    email,
    password_hash: hash,
    role: finalRole,
  });
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
  const { username, password } = req.body || {};
  if (!username || !password)
    return res.status(400).json({ error: "username and password required" });
  const user = await userModel.getUserByUsername(username);
  if (!user) return res.status(401).json({ error: "invalid credentials" });
  if (user.blocked) return res.status(403).json({ error: "account blocked" });
  const ok = user.password_hash
    ? await bcrypt.compare(password, user.password_hash)
    : false;
  if (!ok) return res.status(401).json({ error: "invalid credentials" });

  const token = signToken({
  id: user.id,
  username: user.username,
  role: user.role,
  token_version: user.token_version || 0,
  });
  // update last_login
  await userModel.updateUser(user.id, { last_login: new Date().toISOString() });
  res.json({
    token,
    user: {
      id: user.id,
      username: user.username,
      role: user.role,
      display_name: user.display_name,
      email: user.email,
      token_version: user.token_version || 0,
    },
  });
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
