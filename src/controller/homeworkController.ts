import { v4 as uuidv4 } from "uuid";
import * as hw from "../models/homework.js";
import type { Request, Response } from "express";

export async function create(req: Request, res: Response) {
  const id = uuidv4();
  const payload = req.body;
  const now = new Date().toISOString();
  // determine is_team: prefer explicit flag, otherwise infer from payload
  let is_team: boolean | undefined = payload.is_team;
  if (typeof is_team === "undefined") {
    if (payload.person_name) is_team = false;
    else if (Array.isArray(payload.members) && payload.members.length > 0)
      is_team = true;
    else is_team = true; // default to team if ambiguous
  }

  const item: any = {
    id,
    is_team,
    group_name: is_team ? payload.group_name : undefined,
    person_name: !is_team ? payload.person_name : undefined,
    school_name: payload.school_name,
    members: is_team ? payload.members || [] : undefined,
    images: payload.images || [],
    videos: payload.videos || [],
    urls: payload.urls || [],
    created_at: now,
  };

  // basic request-level validation
  if (item.is_team) {
    if (!item.group_name)
      return res
        .status(400)
        .json({ error: "group_name required for team homework" });
    if (!Array.isArray(item.members) || item.members.length === 0)
      return res
        .status(400)
        .json({ error: "members array required for team homework" });
  } else {
    if (!item.person_name)
      return res
        .status(400)
        .json({ error: "person_name required for personal homework" });
  }

  try {
    const r = await hw.createHomework(item);
    res.status(201).json(r);
  } catch (err: any) {
    // model validation errors -> 400
    return res.status(400).json({ error: err.message || String(err) });
  }
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
