import AWS from "aws-sdk";
import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";

const s3 = new AWS.S3({ region: process.env.AWS_REGION || "ap-southeast-2" });
const TMP_DIR = "/tmp";

let ffmpegChecked = false;
let ffmpegAvailable = false;

function hasFfmpeg() {
  if (!ffmpegChecked) {
    try {
      const r = spawnSync("ffmpeg", ["-version"], { stdio: "ignore" });
      ffmpegAvailable = r.status === 0;
    } catch (err) {
      ffmpegAvailable = false;
    }
    ffmpegChecked = true;
  }
  return ffmpegAvailable;
}

type S3Location = { bucket: string; key: string };

function parseS3Url(url: string): S3Location | null {
  try {
    const u = new URL(url);
    const hostParts = u.hostname.split(".");
    const s3Index = hostParts.indexOf("s3");
    if (s3Index <= 0) return null;
    const bucket = hostParts.slice(0, s3Index).join(".");
    const key = u.pathname.replace(/^\/+/, "");
    if (!bucket || !key) return null;
    return { bucket, key };
  } catch (_) {
    return null;
  }
}

function buildPosterKey(videoKey: string) {
  const dot = videoKey.lastIndexOf(".");
  if (dot === -1) return `${videoKey}.png`;
  return `${videoKey.slice(0, dot)}.png`;
}

function buildPosterUrlFromVideoUrl(url: string) {
  const qIndex = url.indexOf("?");
  const base = qIndex >= 0 ? url.slice(0, qIndex) : url;
  const dot = base.lastIndexOf(".");
  const replaced = dot === -1 ? `${base}.png` : `${base.slice(0, dot)}.png`;
  const suffix = qIndex >= 0 ? url.slice(qIndex) : "";
  return `${replaced}${suffix}`;
}

async function downloadToFile(bucket: string, key: string, outPath: string) {
  await fs.promises.mkdir(path.dirname(outPath), { recursive: true });
  return new Promise<void>((resolve, reject) => {
    const stream = s3.getObject({ Bucket: bucket, Key: key }).createReadStream();
    const file = fs.createWriteStream(outPath);
    let finished = false;
    const onError = (err: any) => {
      if (finished) return;
      finished = true;
      stream.destroy();
      file.destroy();
      reject(err);
    };
    file.on("finish", () => {
      if (finished) return;
      finished = true;
      resolve();
    });
    stream.on("error", onError);
    file.on("error", onError);
    stream.pipe(file);
  });
}

function extractPosterFrame(inputPath: string, outputPath: string) {
  const args = [
    "-y",
    "-ss",
    "0.5",
    "-i",
    inputPath,
    "-frames:v",
    "1",
    outputPath,
  ];
  const r = spawnSync("ffmpeg", args, { stdio: "ignore" });
  if (r.status !== 0) {
    throw new Error(`ffmpeg exited with status ${r.status}`);
  }
}

async function uploadPoster(bucket: string, key: string, filePath: string) {
  const body = await fs.promises.readFile(filePath);
  await s3
    .upload({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: "image/png",
    })
    .promise();
}

async function ensurePosterForUrl(url: string): Promise<string | null> {
  const parsed = parseS3Url(url);
  if (!parsed) return;

  const { bucket, key } = parsed;
  const posterKey = buildPosterKey(key);
  const posterUrl = buildPosterUrlFromVideoUrl(url);

  try {
    await s3.headObject({ Bucket: bucket, Key: posterKey }).promise();
    return posterUrl;
  } catch (err: any) {
    const code = err?.code;
    if (code && !["NotFound", "404", "NoSuchKey"].includes(code)) {
      console.error("[videoPoster] headObject failed", {
        url,
        error: err.message || String(err),
      });
      return null;
    }
  }

  if (!hasFfmpeg()) {
    console.warn("[videoPoster] ffmpeg unavailable, skip poster generation");
    return null;
  }

  const base = `poster-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const videoPath = path.join(TMP_DIR, `${base}.source`);
  const posterPath = path.join(TMP_DIR, `${base}.png`);

  try {
    await downloadToFile(bucket, key, videoPath);
    extractPosterFrame(videoPath, posterPath);
    await uploadPoster(bucket, posterKey, posterPath);
    return posterUrl;
  } catch (err) {
    console.error("[videoPoster] poster generation failed", {
      url,
      error: (err as any)?.message || String(err),
    });
    return null;
  } finally {
    await fs.promises.unlink(videoPath).catch(() => {});
    await fs.promises.unlink(posterPath).catch(() => {});
  }
}

export async function ensureVideoPosters(urls: string[]): Promise<string[]> {
  const seen = new Set<string>();
  const posters = new Set<string>();
  for (const url of urls) {
    const normalized = String(url || "").trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    const posterUrl = await ensurePosterForUrl(normalized);
    if (posterUrl) posters.add(posterUrl);
  }
  return Array.from(posters);
}
