import { v4 as uuidv4 } from "uuid";
import * as hw from "../models/homework.js";
import type { Request, Response } from "express";

export async function create(req: Request, res: Response) {
  const id = uuidv4();
  const payload = req.body;
  const now = new Date().toISOString();
  const title = typeof payload.title === "string" ? payload.title.trim() : "";
  const description =
    typeof payload.description === "string" ? payload.description.trim() : "";
  if (!title) return res.status(400).json({ error: "title required" });
  if (!description)
    return res.status(400).json({ error: "description required" });
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
    title,
    description,
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
  const limit = Number(req.query.limit) || 100;
  const rows = await hw.listHomeworks(limit);
  res.json(rows);
}

export async function listByPerson(req: Request, res: Response) {
  const person = req.params.person || (req.query.person as string);
  if (!person) return res.status(400).json({ error: "person required" });
  const limit = Number(req.query.limit) || 100;
  const rows = await hw.listHomeworksByPerson(person, limit);
  res.json(rows);
}

export async function listByGroup(req: Request, res: Response) {
  const group = req.params.group || (req.query.group as string);
  if (!group) return res.status(400).json({ error: "group required" });
  const limit = Number(req.query.limit) || 100;
  const rows = await hw.listHomeworksByGroup(group, limit);
  res.json(rows);
}

export async function listBySchool(req: Request, res: Response) {
  const school = req.params.school || (req.query.school as string);
  if (!school) return res.status(400).json({ error: "school required" });
  const limit = Number(req.query.limit) || 100;
  const rows = await hw.listHomeworksBySchool(school, limit);
  res.json(rows);
}

export async function listWithImages(req: Request, res: Response) {
  const limit = Number(req.query.limit) || 100;
  const rows = await hw.listHomeworksWithImages(limit);
  res.json(rows);
}

export async function listWithVideos(req: Request, res: Response) {
  const limit = Number(req.query.limit) || 100;
  const rows = await hw.listHomeworksWithVideos(limit);
  res.json(rows);
}

export async function listWithUrls(req: Request, res: Response) {
  const limit = Number(req.query.limit) || 100;
  const rows = await hw.listHomeworksWithUrls(limit);
  res.json(rows);
}

export async function update(req: Request, res: Response) {
  const id = req.params.id;
  if (!id) return res.status(400).json({ error: "id required" });
  const patch = req.body;
  if (typeof patch.title === "string") patch.title = patch.title.trim();
  if (typeof patch.description === "string")
    patch.description = patch.description.trim();
  const r = await hw.updateHomework(id, patch as any);
  if (!r) return res.status(404).json({ error: "not found" });
  res.json(r);
}

export async function remove(req: Request, res: Response) {
  const id = req.params.id;
  if (!id) return res.status(400).json({ error: "id required" });
  try {
    await hw.deleteHomework(id);
    res.status(204).send();
  } catch (err: any) {
    console.error("[remove] failed to delete homework", {
      id,
      err: err?.message || String(err),
    });
    return res.status(500).json({ error: "failed to delete homework" });
  }
}
