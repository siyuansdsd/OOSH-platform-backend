import { v4 as uuidv4 } from "uuid";
import * as hw from "../models/homework.js";
import type { Request, Response } from "express";

export async function create(req: Request, res: Response) {
  const id = uuidv4();
  const payload = req.body;
  const now = new Date().toISOString();
  const item = {
    id,
    group_name: payload.group_name,
    school_name: payload.school_name,
    members: payload.members || [],
    images: payload.images || [],
    videos: payload.videos || [],
    urls: payload.urls || [],
    created_at: now,
  };
  const r = await hw.createHomework(item);
  res.status(201).json(r);
}

export async function getOne(req: Request, res: Response) {
  const id = req.params.id;
  if (!id) return res.status(400).json({ error: "id required" });
  const r = await hw.getHomework(id);
  if (!r) return res.status(404).json({ error: "not found" });
  res.json(r);
}

export async function list(req: Request, res: Response) {
  const rows = await hw.listHomeworks(100);
  res.json(rows);
}

export async function update(req: Request, res: Response) {
  const id = req.params.id;
  if (!id) return res.status(400).json({ error: "id required" });
  const patch = req.body;
  const r = await hw.updateHomework(id, patch as any);
  if (!r) return res.status(404).json({ error: "not found" });
  res.json(r);
}

export async function remove(req: Request, res: Response) {
  const id = req.params.id;
  if (!id) return res.status(400).json({ error: "id required" });
  await hw.deleteHomework(id);
  res.status(204).send();
}
