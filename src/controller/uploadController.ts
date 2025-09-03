import AWS from "aws-sdk";
import type { Request, Response } from "express";

const s3 = new AWS.S3({ region: process.env.AWS_REGION || "ap-southeast-1" });
const BUCKET = process.env.S3_BUCKET || "";

function slugify(input: string) {
  return (input || "unknown")
    .toString()
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function makeKey({
  schoolName,
  groupName,
  homeworkId,
  filename,
}: {
  schoolName?: string;
  groupName?: string;
  homeworkId: string;
  filename: string;
}) {
  const school = slugify(schoolName || "unknown");
  const group = slugify(groupName || "unknown");
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const ts = Date.now();
  const safeName = slugify(filename.replace(/\s+/g, "-"));
  // template: school/{schoolSlug}/{YYYY}/{MM}/{timestamp}/{groupSlug}/{homeworkId}/{timestamp}-{slugifiedFilename}
  return `school/${school}/${y}/${m}/${ts}/${group}/${homeworkId}/${ts}-${safeName}`;
}

export async function presignHandler(req: Request, res: Response) {
  const { homeworkId, filename, contentType, schoolName, groupName } =
    req.body || {};
  if (!homeworkId || !filename)
    return res.status(400).json({ error: "homeworkId and filename required" });
  if (!BUCKET)
    return res.status(500).json({ error: "S3_BUCKET not configured" });

  const key = makeKey({ schoolName, groupName, homeworkId, filename });
  const params = {
    Bucket: BUCKET,
    Key: key,
    ContentType: contentType || "application/octet-stream",
  } as AWS.S3.PutObjectRequest;

  const expires = 900; // 15 minutes
  try {
    const uploadUrl = await s3.getSignedUrlPromise("putObject", {
      ...params,
      Expires: expires,
    });
    const fileUrl = `https://${BUCKET}.s3.${s3.config.region}.amazonaws.com/${key}`;
    res.json({ uploadUrl, fileUrl, key, expiresIn: expires });
  } catch (err) {
    console.error("presign error", err);
    res.status(500).json({ error: "presign failed" });
  }
}
