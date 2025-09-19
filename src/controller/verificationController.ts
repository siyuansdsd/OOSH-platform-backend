import type { Request, Response } from "express";
import { v4 as uuidv4 } from "uuid";
import { redisSet, redisGet, redisDel } from "../utils/redisClient.js";
import { sendVerificationEmail } from "../utils/ses.js";

const CODE_TTL = 300; // 5 minutes

export async function sendCode(req: Request, res: Response) {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: "email required" });
  const code = Math.floor(100000 + Math.random() * 900000).toString();
  const key = `verify:${email}`;
  try {
    await redisSet(key, code, CODE_TTL);
    await sendVerificationEmail(email, code);
    return res.json({ ok: true });
  } catch (err: any) {
    console.error("sendCode err", err);
    return res.status(500).json({ error: "send failed" });
  }
}

export async function verifyCode(req: Request, res: Response) {
  const { email, code } = req.body;
  if (!email || !code)
    return res.status(400).json({ error: "email and code required" });
  const key = `verify:${email}`;
  try {
    const v = await redisGet(key);
    if (v === code) {
      await redisDel(key);
      return res.json({ ok: true });
    }
    return res.status(400).json({ error: "invalid" });
  } catch (err: any) {
    console.error("verifyCode err", err);
    return res.status(500).json({ error: "verify failed" });
  }
}
