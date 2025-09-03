import pool from "./db.js";

export type Homework = {
  id: string; // uuid
  group_name: string;
  school_name: string;
  members: string[];
  images: string[];
  videos: string[];
  urls: string[];
  created_at: string;
};

export async function initTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS homeworks (
      id TEXT PRIMARY KEY,
      group_name TEXT NOT NULL,
      school_name TEXT NOT NULL,
      members TEXT[] NOT NULL,
      images TEXT[] DEFAULT '{}',
      videos TEXT[] DEFAULT '{}',
      urls TEXT[] DEFAULT '{}',
      created_at TIMESTAMP WITH TIME ZONE NOT NULL
    )
  `);
}

export async function createHomework(h: Homework) {
  const res = await pool.query(
    `INSERT INTO homeworks(id, group_name, school_name, members, images, videos, urls, created_at)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8)
     RETURNING *`,
    [
      h.id,
      h.group_name,
      h.school_name,
      h.members,
      h.images,
      h.videos,
      h.urls,
      h.created_at,
    ]
  );
  return res.rows[0];
}

export async function getHomework(id: string) {
  const r = await pool.query("SELECT * FROM homeworks WHERE id=$1", [id]);
  return r.rows[0];
}

export async function listHomeworks(limit = 100) {
  const r = await pool.query(
    "SELECT * FROM homeworks ORDER BY created_at DESC LIMIT $1",
    [limit]
  );
  return r.rows;
}

export async function updateHomework(id: string, patch: Partial<Homework>) {
  const existing = await getHomework(id);
  if (!existing) return null;
  const merged = { ...existing, ...patch } as any;
  const r = await pool.query(
    `UPDATE homeworks SET group_name=$1, school_name=$2, members=$3, images=$4, videos=$5, urls=$6 WHERE id=$7 RETURNING *`,
    [
      merged.group_name,
      merged.school_name,
      merged.members,
      merged.images,
      merged.videos,
      merged.urls,
      id,
    ]
  );
  return r.rows[0];
}

export async function deleteHomework(id: string) {
  await pool.query("DELETE FROM homeworks WHERE id=$1", [id]);
}
