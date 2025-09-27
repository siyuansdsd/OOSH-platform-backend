import AWS from "aws-sdk";

export const ALLOWED_HOMEWORK_SCHOOLS = [
  "The Y Panania OSHC",
  "Eastwood Before & After School Care Centre Inc",
  "Randwick Out of School Hours Care (Randwick OOSH)",
  "Crown Street Out of School Hours Care (OSHC)",
  "The Y Oakhill Drive OSHC",
  "Max Hacker Tech Club",
] as const;

export type HomeworkSchool = (typeof ALLOWED_HOMEWORK_SCHOOLS)[number];

export type Homework = {
  id: string; // uuid
  // is_team: true => team homework (requires group_name + members)
  // is_team: false => personal homework (requires person_name)
  is_team: boolean;
  title: string;
  description: string;
  group_name?: string;
  person_name?: string;
  school_name: HomeworkSchool;
  members?: string[];
  images?: string[];
  videos?: string[];
  urls?: string[];
  created_at: string;
};

const ddb = new AWS.DynamoDB.DocumentClient({
  region: process.env.AWS_REGION || "ap-southeast-2",
});
const s3 = new AWS.S3({ region: process.env.AWS_REGION || "ap-southeast-2" });
const BUCKET = process.env.S3_BUCKET || "";
const TABLE = process.env.DYNAMO_TABLE || "homeworks";

export async function initTable() {
  // DynamoDB table creation requires admin permissions; if table exists do nothing.
  // We don't create the table programmatically here to avoid permission issues; return quickly.
  return;
}

function validateRequiredFields(
  h: Partial<Homework>,
  opts: { requireMedia?: boolean } = { requireMedia: true }
) {
  const missing: string[] = [];
  if (!h.id) missing.push("id");
  if (h.is_team === undefined) missing.push("is_team");
  if (typeof h.title !== "string" || !h.title.trim()) missing.push("title");
  if (typeof h.description !== "string" || !h.description.trim())
    missing.push("description");
  if (!h.school_name) {
    missing.push("school_name");
  } else if (
    !ALLOWED_HOMEWORK_SCHOOLS.includes(h.school_name as HomeworkSchool)
  ) {
    throw new Error(
      `Invalid school_name. Allowed schools: ${ALLOWED_HOMEWORK_SCHOOLS.join(
        ", "
      )}`
    );
  }
  // conditional: team requires group_name + members; personal requires person_name
  if (h.is_team) {
    if (!h.group_name) missing.push("group_name");
    if (!h.members) missing.push("members");
  } else {
    if (!h.person_name) missing.push("person_name");
  }
  if (!h.created_at) missing.push("created_at");
  if (missing.length) {
    throw new Error(`Missing required fields: ${missing.join(", ")}`);
  }
  if (h.is_team && !Array.isArray(h.members)) {
    throw new Error("members must be an array of strings");
  }
  // validate optional media fields: if present they must be arrays
  if ((h as any).images !== undefined && !Array.isArray((h as any).images)) {
    throw new Error("images must be an array of strings");
  }
  if ((h as any).videos !== undefined && !Array.isArray((h as any).videos)) {
    throw new Error("videos must be an array of strings");
  }
  if ((h as any).urls !== undefined && !Array.isArray((h as any).urls)) {
    throw new Error("urls must be an array of strings");
  }

  // ensure at least one of images, videos, urls is present and non-empty when required
  if (opts.requireMedia) {
    const hasImages =
      Array.isArray((h as any).images) && (h as any).images.length > 0;
    const hasVideos =
      Array.isArray((h as any).videos) && (h as any).videos.length > 0;
    const hasUrls =
      Array.isArray((h as any).urls) && (h as any).urls.length > 0;
    if (!hasImages && !hasVideos && !hasUrls) {
      throw new Error(
        "At least one of images, videos or urls must be provided"
      );
    }
  }
}

export async function createHomework(h: Homework) {
  const item = { ...h } as any;
  // validate required fields (images/videos/urls are optional)
  validateRequiredFields(item);
  item.title = item.title.trim();
  item.description = item.description.trim();

  // construct PK/SK and stable index fields
  item.PK = `HOMEWORK#${item.id}`;
  item.SK = `META#${item.created_at}`;
  if (!item.school_id) item.school_id = item.school_name;
  if (Array.isArray(item.images) && item.images.length > 0)
    item.preview = item.images[0];

  // set attributes for sparse GSIs
  item.entityType = "HOMEWORK";
  if (Array.isArray(item.images) && item.images.length > 0)
    item.has_images = "1";
  if (Array.isArray(item.videos) && item.videos.length > 0)
    item.has_videos = "1";
  if (Array.isArray(item.urls) && item.urls.length > 0) item.has_urls = "1";

  // write main item
  await ddb.put({ TableName: TABLE, Item: item }).promise();
  return item;
}

// Create a homework draft which skips the media presence requirement.
// Useful when you want to create the homework record first, then upload files and update.
export async function createHomeworkDraft(h: Homework) {
  const item = { ...h } as any;
  // validate required fields but allow empty media
  validateRequiredFields(item, { requireMedia: false });
  item.title = item.title.trim();
  item.description = item.description.trim();

  // construct PK/SK and stable index fields
  item.PK = `HOMEWORK#${item.id}`;
  item.SK = `META#${item.created_at}`;
  if (!item.school_id) item.school_id = item.school_name;
  if (Array.isArray(item.images) && item.images.length > 0)
    item.preview = item.images[0];

  // set attributes for sparse GSIs
  item.entityType = "HOMEWORK";
  if (Array.isArray(item.images) && item.images.length > 0)
    item.has_images = "1";
  if (Array.isArray(item.videos) && item.videos.length > 0)
    item.has_videos = "1";
  if (Array.isArray(item.urls) && item.urls.length > 0) item.has_urls = "1";

  // write main item
  await ddb.put({ TableName: TABLE, Item: item }).promise();
  return item;
}

export async function getHomework(id: string) {
  const pk = `HOMEWORK#${id}`;
  const r = await ddb
    .query({
      TableName: TABLE,
      KeyConditionExpression: "PK = :p and begins_with(SK, :s)",
      ExpressionAttributeValues: { ":p": pk, ":s": "META#" },
      Limit: 1,
    })
    .promise();
  return (r.Items && r.Items[0]) || null;
}

export async function listHomeworks(limit = 100) {
  // prefer the AllHomeworksIndex which lists by created_at
  return listAllHomeworks(limit);
}

export async function updateHomework(id: string, patch: Partial<Homework>) {
  const existing = await getHomework(id);
  if (!existing) return null;
  const updated = { ...existing, ...patch } as any;
  // ensure required fields are still present after patch
  try {
    validateRequiredFields(updated);
  } catch (err) {
    throw err;
  }
  if (typeof updated.title === "string") updated.title = updated.title.trim();
  if (typeof updated.description === "string")
    updated.description = updated.description.trim();
  // ensure PK/SK remain present
  updated.PK = `HOMEWORK#${updated.id}`;
  updated.SK = `META#${updated.created_at}`;
  // maintain sparse GSI flags and preview
  updated.entityType = "HOMEWORK";
  if (Array.isArray(updated.images) && updated.images.length > 0)
    updated.has_images = "1";
  else delete updated.has_images;
  if (Array.isArray(updated.videos) && updated.videos.length > 0)
    updated.has_videos = "1";
  else delete updated.has_videos;
  if (Array.isArray(updated.urls) && updated.urls.length > 0)
    updated.has_urls = "1";
  else delete updated.has_urls;
  updated.preview =
    Array.isArray(updated.images) && updated.images.length > 0
      ? updated.images[0]
      : updated.preview;

  // write updated main item
  await ddb.put({ TableName: TABLE, Item: updated }).promise();

  // no member mapping logic: team vs personal is handled by fields on the main item

  return updated;
}

// Query helpers for GSIs / sparse indexes
export async function listAllHomeworks(limit = 100) {
  const r = await ddb
    .query({
      TableName: TABLE,
      IndexName: "homework_index",
      KeyConditionExpression: "entityType = :e",
      ExpressionAttributeValues: { ":e": "HOMEWORK" },
      ScanIndexForward: false,
      Limit: limit,
    })
    .promise();
  return r.Items || [];
}

export async function listHomeworksWithImages(limit = 100) {
  const r = await ddb
    .query({
      TableName: TABLE,
      IndexName: "HasImageIndex",
      KeyConditionExpression: "has_images = :h",
      ExpressionAttributeValues: { ":h": "1" },
      ScanIndexForward: false,
      Limit: limit,
    })
    .promise();
  return r.Items || [];
}

export async function listHomeworksWithVideos(limit = 100) {
  const r = await ddb
    .query({
      TableName: TABLE,
      IndexName: "HasVideosIndex",
      KeyConditionExpression: "has_videos = :h",
      ExpressionAttributeValues: { ":h": "1" },
      ScanIndexForward: false,
      Limit: limit,
    })
    .promise();
  return r.Items || [];
}

export async function listHomeworksWithUrls(limit = 100) {
  const r = await ddb
    .query({
      TableName: TABLE,
      IndexName: "HasUrlsIndex",
      KeyConditionExpression: "has_urls = :h",
      ExpressionAttributeValues: { ":h": "1" },
      ScanIndexForward: false,
      Limit: limit,
    })
    .promise();
  return r.Items || [];
}

// List homeworks for a given person (personal homework).
// This requires a GSI named 'person_index' where PK is person_name (or person_id) and SK is created_at.
// For this to work, items for personal homeworks must include the attribute `person_name` (or `person_id`).
export async function listHomeworksByPerson(person: string, limit = 100) {
  const r = await ddb
    .query({
      TableName: TABLE,
      IndexName: "person_index",
      KeyConditionExpression: "person_name = :p",
      ExpressionAttributeValues: { ":p": person },
      ScanIndexForward: false,
      Limit: limit,
    })
    .promise();
  return r.Items || [];
}

// List homeworks for a given group/team (team homework).
// Requires a GSI named 'group_index' where partition key is group_name (or group_id) and SK is created_at.
export async function listHomeworksByGroup(group: string, limit = 100) {
  const r = await ddb
    .query({
      TableName: TABLE,
      IndexName: "group_index",
      KeyConditionExpression: "group_name = :g",
      ExpressionAttributeValues: { ":g": group },
      ScanIndexForward: false,
      Limit: limit,
    })
    .promise();
  return r.Items || [];
}

// List homeworks for a given school, ordered by created_at desc.
// Requires a GSI named 'school_index' where partition key is school_id (or school_name) and SK is created_at.
export async function listHomeworksBySchool(school: string, limit = 100) {
  const r = await ddb
    .query({
      TableName: TABLE,
      IndexName: "school_index",
      KeyConditionExpression: "school_id = :s",
      ExpressionAttributeValues: { ":s": school },
      ScanIndexForward: false,
      Limit: limit,
    })
    .promise();
  return r.Items || [];
}

export async function deleteHomework(id: string) {
  try {
    const existing = await getHomework(id);
    if (!existing) {
      console.info("[deleteHomework] not found", { id });
      return;
    }

    console.info("[deleteHomework] start", { id, bucket: BUCKET });

    // Collect S3 keys from images/videos/urls fields (if they reference this bucket)
    function extractS3Key(possibleUrl: string): string | null {
      if (!possibleUrl) return null;
      // if it's already a key (no protocol), assume it's a key
      if (!possibleUrl.startsWith("http")) return possibleUrl;
      // try to find amazonaws.com/ and take the rest as key
      const marker = ".amazonaws.com/";
      const idx = possibleUrl.indexOf(marker);
      if (idx >= 0) return possibleUrl.slice(idx + marker.length);
      // fallback: if URL contains bucket.s3..., attempt split at bucket name
      if (BUCKET && possibleUrl.includes(BUCKET)) {
        const i = possibleUrl.indexOf(BUCKET);
        const after = possibleUrl.slice(i + BUCKET.length + 1);
        return after || null;
      }
      return null;
    }

    const keys = new Set<string>();
    const collect = (arr?: any[]) => {
      if (Array.isArray(arr)) {
        for (const u of arr) {
          const k = extractS3Key(String(u || ""));
          if (k) keys.add(k);
        }
      }
    };

    collect(existing.images);
    collect(existing.videos);
    collect(existing.urls);

    // batch delete S3 objects if any
    if (keys.size > 0 && BUCKET) {
      const Objects = Array.from(keys).map((Key) => ({ Key }));
      try {
        const result = await s3
          .deleteObjects({
            Bucket: BUCKET,
            Delete: { Objects },
          })
          .promise();
        if (result && (result as any).Errors && (result as any).Errors.length) {
          console.error(
            "s3.deleteObjects reported errors",
            (result as any).Errors
          );
          // attempt single deletes for failed keys
          for (const errItem of (result as any).Errors) {
            try {
              await s3
                .deleteObject({ Bucket: BUCKET, Key: errItem.Key })
                .promise();
            } catch (e) {
              console.error(
                "failed to delete s3 object during retry",
                errItem.Key,
                e
              );
            }
          }
        }
      } catch (err) {
        // fallback: attempt individual deletes and continue
        console.error("bulk s3 delete failed, attempting singles", err);
        for (const k of Objects) {
          try {
            await s3.deleteObject({ Bucket: BUCKET, Key: k.Key }).promise();
          } catch (e) {
            console.error("failed to delete s3 object", k.Key, e);
          }
        }
      }
    }

    // delete main item
    try {
      await ddb
        .delete({
          TableName: TABLE,
          Key: {
            PK: `HOMEWORK#${existing.id}`,
            SK: `META#${existing.created_at}`,
          },
        })
        .promise();
      console.info("[deleteHomework] deleted dynamodb item", { id });
    } catch (ddbErr) {
      console.error("[deleteHomework] dynamodb delete failed", {
        id,
        err: ddbErr,
      });
      throw ddbErr;
    }
    return;
  } catch (err) {
    console.error("[deleteHomework] failed", {
      id,
      err: (err as any)?.message || String(err),
    });
    throw err;
  }
}
