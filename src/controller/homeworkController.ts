import { v4 as uuidv4 } from "uuid";
import * as hw from "../models/homework.js";
import type { Request, Response } from "express";
import { ensureVideoPosters } from "../utils/videoPoster.js";

function sanitizeHomeworkRecord(record: any) {
  if (!record) return record;
  const cloned = { ...record };
  delete cloned.video_posters;
  return cloned;
}

function sanitizeHomeworkList(records: any[]) {
  return records.map(sanitizeHomeworkRecord);
}

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
    video_posters: [],
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
    let created = await hw.createHomework(item);
    if (Array.isArray(created?.videos) && created.videos.length > 0) {
      try {
        const posters = await ensureVideoPosters(
          created.videos,
          created.video_posters || []
        );
        if (posters.length > 0) {
          await hw.updateHomework(id, { video_posters: posters });
        }
      } catch (posterErr: any) {
        console.error("[create] poster generation failed", {
          id,
          error: posterErr?.message || String(posterErr),
        });
      }
    }
    res.status(201).json(sanitizeHomeworkRecord(created));
  } catch (err: any) {
    // model validation errors -> 400
    return res.status(400).json({ error: err.message || String(err) });
  }
}

export async function getOne(req: Request, res: Response) {
  const id = req.params.id;
  if (!id) return res.status(400).json({ error: "id required" });
  console.debug("[getOne] received id", { id });
  const r = await hw.getHomework(id);
  if (!r) {
    console.info("[getOne] homework not found", { id });
    return res.status(404).json({ error: "not found" });
  }
  console.debug("[getOne] found homework", { id });
  res.json(sanitizeHomeworkRecord(r));
}

export async function list(req: Request, res: Response) {
  // Query params
  const page = Math.max(1, Number(req.query.page) || 1);
  // priority: limit > per_page/pageSize
  const pageSizeRaw =
    req.query.pageSize || req.query.per_page || req.query.limit;
  const pageSize = Number(pageSizeRaw) || 12;
  const school = (req.query.school as string) || undefined;
  const name = (req.query.name as string) || undefined;
  const type = (req.query.type as string) || "all"; // media | website | all

  const cursorParam =
    typeof req.query.cursor === "string" ? req.query.cursor : undefined;

  if (!school && !name && page > 1 && !cursorParam) {
    return res.status(400).json({
      error: "cursor required for pages beyond the first",
    });
  }

  if (!school && !name) {
    const decodeCursor = (value: string) => {
      try {
        const json = Buffer.from(value, "base64").toString("utf8");
        return JSON.parse(json);
      } catch (err) {
        throw new Error("invalid cursor");
      }
    };

    const encodeCursor = (key: any) =>
      Buffer.from(JSON.stringify(key)).toString("base64");

    let exclusiveStartKey: any;
    if (cursorParam) {
      try {
        exclusiveStartKey = decodeCursor(cursorParam);
      } catch (err: any) {
        return res.status(400).json({ error: err.message || "invalid cursor" });
      }
    }

    try {
      const pageResult = await hw.listAllHomeworksPage(
        Math.min(1000, pageSize),
        exclusiveStartKey
      );

      let pageRows = pageResult.items || [];

      if (type === "media") {
        pageRows = pageRows.filter(
          (r: any) => r.has_images || r.has_videos || r.has_urls
        );
      } else if (type === "website") {
        pageRows = pageRows.filter(
          (r: any) => r.urls && r.urls.length > 0
        );
      }

      pageRows.sort((a: any, b: any) => {
        const A = a.created_at || "";
        const B = b.created_at || "";
        if (A === B) return 0;
        return A < B ? 1 : -1;
      });

      const items = sanitizeHomeworkList(pageRows);
      const hasMore = !!pageResult.lastEvaluatedKey;
      const nextCursor = hasMore
        ? encodeCursor(pageResult.lastEvaluatedKey)
        : null;
      const approxTotal =
        (page - 1) * pageSize + items.length + (hasMore ? 1 : 0);

      res.json({
        items,
        total: approxTotal,
        page,
        pageSize,
        hasMore,
        nextCursor,
      });
      return;
    } catch (err: any) {
      console.error("[list] failed to list homeworks", {
        error: err?.message || String(err),
      });
      return res.status(500).json({ error: "failed to list homeworks" });
    }
  }

  const SCHOOL_FETCH_LIMIT = 1000;
  let rows: any[] = [];
  try {
    if (school) {
      // pull a wider set when scoping to a school so search covers all matches
      rows = await hw.listHomeworksBySchool(school, SCHOOL_FETCH_LIMIT);
    } else {
      const baseLimit = name ? 1000 : Math.min(1000, page * pageSize + 1);
      rows = await hw.listAllHomeworks(baseLimit);
    }
  } catch (err: any) {
    return res.status(500).json({ error: "failed to list homeworks" });
  }

  // apply server-side filters
  let filtered = rows;
  if (school) {
    filtered = filtered.filter((r: any) => r.school_name === school);
  }
  if (type === "media") {
    filtered = filtered.filter(
      (r: any) => r.has_images || r.has_videos || r.has_urls
    );
  } else if (type === "website") {
    filtered = filtered.filter((r: any) => r.urls && r.urls.length > 0);
  }
  if (name) {
    const q = name.toLowerCase();
    filtered = filtered.filter((r: any) => {
      const memberMatch = Array.isArray(r.members)
        ? r.members.some((m: any) =>
            typeof m === "string" && m.toLowerCase().includes(q)
          )
        : false;
      return (
        (r.title && r.title.toLowerCase().includes(q)) ||
        (r.group_name && r.group_name.toLowerCase().includes(q)) ||
        (r.person_name && r.person_name.toLowerCase().includes(q)) ||
        memberMatch
      );
    });
  }

  // ensure sort by created_at desc
  filtered.sort((a: any, b: any) => {
    const A = a.created_at || "";
    const B = b.created_at || "";
    if (A === B) return 0;
    return A < B ? 1 : -1;
  });

  const total = filtered.length;

  if (school || name) {
    res.json({
      items: sanitizeHomeworkList(filtered),
      total,
      page: 1,
      pageSize: total,
      hasMore: false,
      nextCursor: null,
    });
    return;
  }

  const start = (page - 1) * pageSize;
  const end = start + pageSize;
  const items = sanitizeHomeworkList(filtered.slice(start, end));
  const hasMore = filtered.length > page * pageSize;

  res.json({
    items,
    total,
    page,
    pageSize,
    hasMore,
    nextCursor: null,
  });
}

export async function listByPerson(req: Request, res: Response) {
  const person = req.params.person || (req.query.person as string);
  if (!person) return res.status(400).json({ error: "person required" });
  const limit = Number(req.query.limit) || 100;
  const rows = await hw.listHomeworksByPerson(person, limit);
  res.json(sanitizeHomeworkList(rows));
}

export async function listByGroup(req: Request, res: Response) {
  const group = req.params.group || (req.query.group as string);
  if (!group) return res.status(400).json({ error: "group required" });
  const limit = Number(req.query.limit) || 100;
  const rows = await hw.listHomeworksByGroup(group, limit);
  res.json(sanitizeHomeworkList(rows));
}

export async function listBySchool(req: Request, res: Response) {
  const school = req.params.school || (req.query.school as string);
  if (!school) return res.status(400).json({ error: "school required" });
  const limit = Number(req.query.limit) || 100;
  const rows = await hw.listHomeworksBySchool(school, limit);
  res.json(sanitizeHomeworkList(rows));
}

export async function listWithImages(req: Request, res: Response) {
  const limit = Number(req.query.limit) || 100;
  const rows = await hw.listHomeworksWithImages(limit);
  res.json(sanitizeHomeworkList(rows));
}

export async function listWithVideos(req: Request, res: Response) {
  const limit = Number(req.query.limit) || 100;
  const rows = await hw.listHomeworksWithVideos(limit);
  res.json(sanitizeHomeworkList(rows));
}

export async function listWithUrls(req: Request, res: Response) {
  const limit = Number(req.query.limit) || 100;
  const rows = await hw.listHomeworksWithUrls(limit);
  res.json(sanitizeHomeworkList(rows));
}

export async function listAllForAdmin(req: Request, res: Response) {
  try {
    const max = 3000;
    const rows = await hw.listAllHomeworks(max);
    const items = sanitizeHomeworkList(rows);
    res.json({
      items,
      total: items.length,
      limit: max,
    });
  } catch (err: any) {
    console.error("[listAllForAdmin] failed", {
      error: err?.message || String(err),
    });
    res.status(500).json({ error: "failed to list homeworks" });
  }
}

export async function update(req: Request, res: Response) {
  const id = req.params.id;
  if (!id) return res.status(400).json({ error: "id required" });
  const patch = req.body;
  if (patch && Object.prototype.hasOwnProperty.call(patch, "video_posters")) {
    delete patch.video_posters;
  }
  if (typeof patch.title === "string") patch.title = patch.title.trim();
  if (typeof patch.description === "string")
    patch.description = patch.description.trim();
  try {
    let updated = await hw.updateHomework(id, patch as any);
    if (!updated) return res.status(404).json({ error: "not found" });
    if (Array.isArray(updated?.videos) && updated.videos.length > 0) {
      try {
        const posters = await ensureVideoPosters(
          updated.videos,
          updated.video_posters || []
        );
        if (posters.length > 0) {
          await hw.updateHomework(id, { video_posters: posters });
        }
      } catch (posterErr: any) {
        console.error("[update] poster generation failed", {
          id,
          error: posterErr?.message || String(posterErr),
        });
      }
    } else if (
      (!updated?.videos || updated.videos.length === 0) &&
      Array.isArray(updated?.video_posters) &&
      updated.video_posters.length > 0
    ) {
      try {
        await hw.updateHomework(id, { video_posters: [] });
      } catch (posterErr: any) {
        console.error("[update] poster reset failed", {
          id,
          error: posterErr?.message || String(posterErr),
        });
      }
    }
    res.json(sanitizeHomeworkRecord(updated));
  } catch (err: any) {
    console.error("[update] failed", {
      id,
      error: err?.message || String(err),
      stack: err?.stack,
    });
    return res.status(500).json({ error: err?.message || "update failed" });
  }
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
