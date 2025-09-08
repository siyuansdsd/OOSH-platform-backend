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

// Create a homework draft (server-generated id) and return a presigned URL for uploading a file
export async function createDraftAndPresign(req: Request, res: Response) {
  const payload = req.body || {};
  // support single filename or multiple files
  // payload may contain: filename (string) OR filenames: string[] OR files: [{ filename, contentType }]
  let filesInput: Array<{ filename: string; contentType?: string }> = [];
  if (payload.filename) {
    filesInput.push({
      filename: String(payload.filename),
      contentType: payload.contentType,
    });
  } else if (Array.isArray(payload.filenames) && payload.filenames.length > 0) {
    filesInput = payload.filenames.map((f: any) => ({ filename: String(f) }));
  } else if (Array.isArray(payload.files) && payload.files.length > 0) {
    filesInput = payload.files.map((f: any) => ({
      filename: String(f.filename),
      contentType: f.contentType,
    }));
  }
  if (filesInput.length === 0)
    return res.status(400).json({ error: "filename required" });

  const { schoolName, groupName, is_team, person_name, members } = payload;
  if (!BUCKET)
    return res.status(500).json({ error: "S3_BUCKET not configured" });

  // create homework draft
  const { v4: uuidv4 } = await import("uuid");
  const id = uuidv4();
  const now = new Date().toISOString();
  const homework: any = {
    id,
    is_team: typeof is_team === "boolean" ? is_team : !!members,
    group_name: groupName,
    person_name: person_name,
    members: members || [],
    school_name: schoolName,
    images: [],
    videos: [],
    urls: [],
    created_at: now,
  };

  try {
    const hwModel = await import("../models/homework.js");
    await hwModel.createHomeworkDraft(homework as any);
  } catch (err) {
    console.error("create draft error", err);
    return res.status(500).json({ error: "failed to create draft" });
  }
  // generate presigned urls for each requested file
  const expires = 900;
  try {
    const presigns: Array<any> = [];
    for (const f of filesInput) {
      const key = makeKey({
        schoolName,
        groupName,
        homeworkId: id,
        filename: f.filename,
      });
      const params = {
        Bucket: BUCKET,
        Key: key,
        ContentType: f.contentType || "application/octet-stream",
      } as AWS.S3.PutObjectRequest;
      const uploadUrl = await s3.getSignedUrlPromise("putObject", {
        ...params,
        Expires: expires,
      });
      const fileUrl = `https://${BUCKET}.s3.${s3.config.region}.amazonaws.com/${key}`;
      presigns.push({
        filename: f.filename,
        uploadUrl,
        fileUrl,
        key,
        expiresIn: expires,
        contentType: params.ContentType,
      });
    }

    // backward-compatible single-file response
    if (presigns.length === 1) {
      const p = presigns[0];
      return res.json({
        uploadUrl: p.uploadUrl,
        fileUrl: p.fileUrl,
        key: p.key,
        expiresIn: p.expiresIn,
        homeworkId: id,
      });
    }

    // multi-file response
    return res.json({ homeworkId: id, presigns });
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

export async function uploadMultiHandler(req: Request, res: Response) {
  const files = (req.files as Express.Multer.File[] | undefined) || [];
  const { homeworkId, schoolName, groupName } = req.body || {};
  if (!files || files.length === 0)
    return res.status(400).json({ error: "files required" });
  if (!BUCKET)
    return res.status(500).json({ error: "S3_BUCKET not configured" });

  const results: Array<{
    filename: string;
    key: string;
    fileUrl: string;
    location?: string;
    compressed?: boolean;
    error?: string;
  }> = [];

  try {
    // process files sequentially to avoid overwhelming memory/CPU. Could be parallelized with concurrency limit.
    for (const file of files) {
      const filename = file.originalname || `file-${Date.now()}`;
      const contentType = file.mimetype || "application/octet-stream";
      const isImage = /^image\//.test(contentType);
      const isVideo = /^video\//.test(contentType);

      try {
        let uploadBuffer: Buffer = file.buffer;
        let uploadContentType = contentType;
        let compressed = false;

        if (isImage) {
          const r = await compressImageBuffer(file.buffer, contentType);
          uploadBuffer = r.buffer;
          uploadContentType = r.contentType;
          compressed = true;
        } else if (isVideo) {
          if (hasFfmpeg()) {
            try {
              const out = await compressVideoBufferToMp4(file.buffer);
              uploadBuffer = out;
              uploadContentType = "video/mp4";
              compressed = true;
            } catch (e) {
              console.error("video compress failed, uploading original", e);
              uploadBuffer = file.buffer;
            }
          } else {
            uploadBuffer = file.buffer;
          }
        } else {
          uploadBuffer = file.buffer;
        }

        const key = makeKey({
          schoolName,
          groupName,
          homeworkId: homeworkId || `no-homework-${Date.now()}`,
          filename,
        });
        const params = {
          Bucket: BUCKET,
          Key: key,
          Body: uploadBuffer,
          ContentType: uploadContentType,
        } as AWS.S3.PutObjectRequest;
        const uploaded = await s3.upload(params).promise();
        const fileUrl = `https://${BUCKET}.s3.${s3.config.region}.amazonaws.com/${key}`;

        results.push({
          filename,
          key,
          fileUrl,
          location: (uploaded && (uploaded as any).Location) || undefined,
          compressed,
        });
      } catch (e: any) {
        console.error("file upload error", e);
        results.push({
          filename: file.originalname || "unknown",
          key: "",
          fileUrl: "",
          error: String(e),
        });
      }
    }

    // if homeworkId provided, attempt to append uploaded URLs to the homework's images/videos arrays
    if (homeworkId) {
      try {
        const hwModel = await import("../models/homework.js");
        const existing = await hwModel.getHomework(homeworkId);
        if (existing) {
          const toAddImages: string[] = [];
          const toAddVideos: string[] = [];
          for (const r of results) {
            if (r.fileUrl && !r.error) {
              if (
                /\.(jpg|jpeg|png|webp|gif)$/i.test(r.filename) ||
                r.compressed
              ) {
                toAddImages.push(r.fileUrl);
              } else if (
                /\.(mp4|mov|mkv|webm)$/i.test(r.filename) ||
                r.fileUrl.includes(".mp4")
              ) {
                toAddVideos.push(r.fileUrl);
              } else {
                // default to images for unknown types
                toAddImages.push(r.fileUrl);
              }
            }
          }
          const patch: any = {};
          if (toAddImages.length) {
            patch.images = Array.isArray(existing.images)
              ? [...existing.images, ...toAddImages]
              : toAddImages;
          }
          if (toAddVideos.length) {
            patch.videos = Array.isArray(existing.videos)
              ? [...existing.videos, ...toAddVideos]
              : toAddVideos;
          }
          if (Object.keys(patch).length) {
            await hwModel.updateHomework(homeworkId, patch);
          }
        }
      } catch (e) {
        console.error("failed to update homework with uploaded urls", e);
        // continue; uploads succeeded but homework update failed
      }
    }

    return res.json({ uploaded: results });
  } catch (err) {
    console.error("uploadMultiHandler error", err);
    return res
      .status(500)
      .json({ error: "upload failed", details: String(err) });
  }
}
