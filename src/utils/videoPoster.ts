import AWS from "aws-sdk";
import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";
import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";

const FFMPEG_PATH = ffmpegInstaller.path;

const s3 = new AWS.S3({ region: process.env.AWS_REGION || "ap-southeast-2" });
const TMP_DIR = "/tmp";

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
    console.debug("[videoPoster] downloading video", { bucket, key, outPath });
    const stream = s3.getObject({ Bucket: bucket, Key: key }).createReadStream();
    const file = fs.createWriteStream(outPath);
    let finished = false;
    const onError = (err: any) => {
      if (finished) return;
      finished = true;
      stream.destroy();
      file.destroy();
      console.error("[videoPoster] download failed", {
        bucket,
        key,
        error: err?.message || String(err),
      });
      reject(err);
    };
    file.on("finish", () => {
      if (finished) return;
      finished = true;
      console.debug("[videoPoster] download complete", { bucket, key });
      resolve();
    });
    stream.on("error", onError);
    file.on("error", onError);
    stream.pipe(file);
  });
}

function extractPosterFrame(inputPath: string, outputPath: string) {
  console.debug("[videoPoster] extracting frame", { inputPath, outputPath });
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
  const timeoutMs = Number(process.env.POSTER_FFMPEG_TIMEOUT || "12000");
  const r = spawnSync(FFMPEG_PATH, args, {
    stdio: "ignore",
    timeout: timeoutMs,
  });
  if (r.error) {
    console.error("[videoPoster] ffmpeg spawn error", {
      error: r.error?.message || String(r.error),
    });
    return false;
  }
  if (r.status !== 0) {
    console.error("[videoPoster] ffmpeg exited with error", {
      status: r.status,
      signal: r.signal,
      stdout: r.stdout?.toString?.(),
      stderr: r.stderr?.toString?.(),
    });
    return false;
  }
  return true;
}

async function uploadPoster(bucket: string, key: string, filePath: string) {
  console.debug("[videoPoster] uploading poster", { bucket, key, filePath });
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
  if (!parsed) return null;

  const { bucket, key } = parsed;
  const posterKey = buildPosterKey(key);
  const posterUrl = buildPosterUrlFromVideoUrl(url);

  if (!FFMPEG_PATH) {
    console.warn("[videoPoster] ffmpeg path unavailable, skip poster generation");
    return null;
  }

  const base = `poster-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const videoPath = path.join(TMP_DIR, `${base}.source`);
  const posterPath = path.join(TMP_DIR, `${base}.png`);

  try {
    await downloadToFile(bucket, key, videoPath);
    const ok = extractPosterFrame(videoPath, posterPath);
    if (!ok) {
      console.warn("[videoPoster] skipping upload due to ffmpeg failure", {
        url,
      });
      return null;
    }

    await uploadPoster(bucket, posterKey, posterPath);
    console.info("[videoPoster] poster generated", {
      url,
      posterKey,
      posterUrl,
    });
    return posterUrl;
  } catch (err) {
    console.error("[videoPoster] poster generation failed", {
      url,
      error: (err as any)?.message || String(err),
      stack: (err as any)?.stack,
    });
    return null;
  } finally {
    await fs.promises.unlink(videoPath).catch(() => {});
    await fs.promises.unlink(posterPath).catch(() => {});
  }
}

export async function ensureVideoPosters(
  urls: string[],
  existingPosters: string[] = []
): Promise<string[]> {
  const seenVideos = new Set<string>();
  const posterSet = new Set(
    (existingPosters || []).map((p) => String(p || "").trim()).filter(Boolean)
  );

  for (const url of urls) {
    const normalized = String(url || "").trim();
    if (!normalized || seenVideos.has(normalized)) continue;
    seenVideos.add(normalized);

    const expectedPoster = buildPosterUrlFromVideoUrl(normalized);
    if (expectedPoster && posterSet.has(expectedPoster)) continue;

    console.debug("[videoPoster] ensure poster", {
      videoUrl: normalized,
      existingCount: posterSet.size,
    });
    const posterUrl = await ensurePosterForUrl(normalized);
    if (posterUrl) posterSet.add(posterUrl);
  }

  console.debug("[videoPoster] posters ensured", {
    totalVideos: urls.length,
    generated: posterSet.size,
  });

  return Array.from(posterSet);
}
