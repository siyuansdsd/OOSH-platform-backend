import AWS from "aws-sdk";
import type { Request, Response } from "express";
import sharp from "sharp";
import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";

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

async function compressImageBuffer(buffer: Buffer, contentType?: string) {
  // Use sharp to auto-orient and resize if large, and recompress
  try {
    const img = sharp(buffer, { failOnError: false }).rotate();
    const meta = await img.metadata();
    // limit to max width 1920 to save size, keep aspect ratio
    if ((meta.width || 0) > 1920) img.resize({ width: 1920 });

    // choose output format based on original
    if (meta.format === "jpeg" || /jpeg/.test(contentType || "")) {
      const out = await img.jpeg({ quality: 80 }).toBuffer();
      return { buffer: out, contentType: "image/jpeg" };
    } else if (meta.format === "png" || /png/.test(contentType || "")) {
      const out = await img.png({ compressionLevel: 8 }).toBuffer();
      return { buffer: out, contentType: "image/png" };
    } else {
      const out = await img.webp({ quality: 80 }).toBuffer();
      return { buffer: out, contentType: "image/webp" };
    }
  } catch (err) {
    console.error("image compress error", err);
    // fallback: return original
    return { buffer, contentType: contentType || "application/octet-stream" };
  }
}

function hasFfmpeg() {
  try {
    const r = spawnSync("ffmpeg", ["-version"], { stdio: "ignore" });
    return r.status === 0 || r.status === null || r.error == null;
  } catch (e) {
    return false;
  }
}

async function compressVideoBufferToMp4(inputBuffer: Buffer): Promise<Buffer> {
  // This requires ffmpeg binary available on the runtime (Lambda layer or container).
  // Use /tmp for intermediate files.
  const tmpDir = "/tmp";
  const inPath = path.join(tmpDir, `in-${Date.now()}`);
  const outPath = path.join(tmpDir, `out-${Date.now()}.mp4`);
  try {
    await fs.promises.writeFile(inPath, inputBuffer);
    // basic transcode command: libx264, reasonable CRF for size/quality tradeoff
    const args = [
      "-y",
      "-i",
      inPath,
      "-c:v",
      "libx264",
      "-preset",
      "fast",
      "-crf",
      "28",
      "-c:a",
      "aac",
      "-b:a",
      "128k",
      "-movflags",
      "+faststart",
      outPath,
    ];
    const r = spawnSync("ffmpeg", args, { stdio: "inherit", timeout: 120000 });
    if (r.status !== 0) {
      throw new Error(`ffmpeg failed with code ${r.status}`);
    }
    const outBuf = await fs.promises.readFile(outPath);
    return outBuf;
  } finally {
    // cleanup
    try {
      await fs.promises.unlink(inPath).catch(() => {});
      await fs.promises.unlink(outPath).catch(() => {});
    } catch (e) {
      // ignore
    }
  }
}

export async function uploadHandler(req: Request, res: Response) {
  // multer should populate req.file when used as middleware
  // @ts-ignore
  const file = req.file as Express.Multer.File | undefined;
  const { homeworkId, filename, schoolName, groupName } = req.body || {};
  if (!file) return res.status(400).json({ error: "file required" });
  if (!homeworkId || !filename)
    return res.status(400).json({ error: "homeworkId and filename required" });
  if (!BUCKET)
    return res.status(500).json({ error: "S3_BUCKET not configured" });

  const contentType = file.mimetype || "application/octet-stream";
  const isImage = contentType.startsWith("image/");
  const isVideo = contentType.startsWith("video/");

  try {
    let uploadBuffer: Buffer | null = null;
    let uploadContentType = contentType;

    if (isImage) {
      const r = await compressImageBuffer(file.buffer, contentType);
      uploadBuffer = r.buffer;
      uploadContentType = r.contentType;
    } else if (isVideo) {
      if (hasFfmpeg()) {
        try {
          const out = await compressVideoBufferToMp4(file.buffer);
          uploadBuffer = out;
          uploadContentType = "video/mp4";
        } catch (e) {
          console.error("video compress failed, uploading original", e);
          // fallback to original
          uploadBuffer = file.buffer;
        }
      } else {
        // ffmpeg not available; upload original and inform user
        uploadBuffer = file.buffer;
      }
    } else {
      // other file types: upload as-is
      uploadBuffer = file.buffer;
    }

    const key = makeKey({ schoolName, groupName, homeworkId, filename });
    const params = {
      Bucket: BUCKET,
      Key: key,
      Body: uploadBuffer,
      ContentType: uploadContentType,
    } as AWS.S3.PutObjectRequest;
    const uploaded = await s3.upload(params).promise();
    const fileUrl = `https://${BUCKET}.s3.${s3.config.region}.amazonaws.com/${key}`;
    res.json({
      key,
      fileUrl,
      location: uploaded.Location,
      compressed: isImage || (isVideo && hasFfmpeg()),
    });
  } catch (err) {
    console.error("uploadHandler error", err);
    res.status(500).json({ error: "upload failed" });
  }
}
