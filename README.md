# OOSH-platform-backend

Backend service for homework management, media uploads and presigned S3 uploads.

## Environment

Set the following environment variables (in `.env` for local dev, or in Lambda environment):

- `AWS_REGION` - AWS region (e.g. `ap-southeast-2`).
- `S3_BUCKET` - S3 bucket name used for uploads.
- `DYNAMO_TABLE` - DynamoDB table name (default: `homeworks`).
- `NODE_ENV` - (optional) `development`/`production`.
- `PORT` - (local dev) port to run express server.

## IAM permissions

Lambda or the process must have these permissions:

- S3: `s3:PutObject`, `s3:GetObject` (for presign/upload and reads)
- DynamoDB: `dynamodb:PutItem`, `dynamodb:Query`, `dynamodb:DeleteItem`, `dynamodb:GetItem`, `dynamodb:UpdateItem`

Adjust resource ARNs to your table and bucket for least privilege.

---

## API Endpoints

Base path: `/api`

### Upload endpoints

1. POST /api/uploads/presign

- Purpose: get a presigned PUT URL for uploading a single file to S3.
- Request body (JSON): - `homeworkId` (string) - used to build the S3 key path (optional but recommended) - `filename` (string) - required - `contentType` (string) - optional - `schoolName` (string) - optional (used in key) - `groupName` (string) - optional (used in key)
- Response (JSON): - `uploadUrl` (string) - signed URL for PUT - `fileUrl` (string) - public S3 URL for reading - `key` (string) - S3 object key - `expiresIn` (number)

Example request body:

```json
{
  "homeworkId": "client-uuid-1",
  "filename": "photo.jpg",
  "contentType": "image/jpeg",
  "schoolName": "Sunrise School",
  "groupName": "Class1A"
}
```

2. POST /api/uploads/create-and-presign

- Purpose: create a homework draft server-side (server generates id) and return one or more presigned PUT URLs in one call. This endpoint is backward-compatible: it accepts a single file (old form) or multiple files (new form) and returns either a single presign or an array of presigns.
- Request body (JSON): supports three input shapes (priority order):
  - `filename` (string) — single file (backwards compatible)
  - `filenames` (string[]) — multiple filenames
  - `files` (array of objects) — multiple files with per-file contentType: [{ filename, contentType }]
  - optional: `schoolName`, `groupName`, `is_team`, `person_name`, `members` (when creating draft homework)
- Response (JSON):
  - Single-file request returns: `{ uploadUrl, fileUrl, key, expiresIn, homeworkId }`
  - Multi-file request returns: `{ homeworkId, presigns: [{ filename, uploadUrl, fileUrl, key, expiresIn, contentType }, ...] }`

完整示例（多文件 + 团队信息）

请求：

```json
POST /api/uploads/create-and-presign
Content-Type: application/json

{
  "files": [
    { "filename": "a.jpg", "contentType": "image/jpeg" },
    { "filename": "b.png", "contentType": "image/png" }
  ],
  "schoolName": "Sunrise School",
  "groupName": "Class1A",
  "is_team": true,
  "members": ["Alice", "Bob"]
}
```

示例响应（multi-file）：

```json
{
  "homeworkId": "generated-server-uuid",
  "presigns": [
    {
      "filename": "a.jpg",
      "uploadUrl": "https://your-bucket.s3.amazonaws.com/…?X-Amz-…",
      "fileUrl": "https://your-bucket.s3.amazonaws.com/path/to/a.jpg",
      "key": "school/sunrise-school/2025/09/…/class1a/homework/generated-server-uuid/…-a.jpg",
      "expiresIn": 900,
      "contentType": "image/jpeg"
    },
    {
      "filename": "b.png",
      "uploadUrl": "https://your-bucket.s3.amazonaws.com/…?X-Amz-…",
      "fileUrl": "https://your-bucket.s3.amazonaws.com/path/to/b.png",
      "key": "school/sunrise-school/2025/09/…/class1a/homework/generated-server-uuid/…-b.png",
      "expiresIn": 900,
      "contentType": "image/png"
    }
  ]
}
```

重要：两种上传模式（选择其一）

- A) JSON presign 流（原有行为，客户端负责文件上传）
  - 请求体为 JSON（例如使用 `files` / `filenames` / `filename`），后端返回 presigned PUT URLs（`presigns`）。
  - 文件二进制不在此 JSON 中，客户端必须对每个返回的 `uploadUrl` 发一个 HTTP PUT，请求体即为文件二进制。
  - curl PUT 示例（将文件二进制上传到 S3 presign）：

```bash
# 假设从上一步响应拿到 presigns[0].uploadUrl 和 presigns[1].uploadUrl

# 上传 a.jpg
curl -v -X PUT "<uploadUrl-for-a.jpg>" \
  -H "Content-Type: image/jpeg" \
  --data-binary @/full/path/to/a.jpg

# 上传 b.png
curl -v -X PUT "<uploadUrl-for-b.png>" \
  -H "Content-Type: image/png" \
  --data-binary @/full/path/to/b.png
```

```javascript
// 浏览器端（presign -> PUT 到 S3）示例
// presigns: [{ filename, uploadUrl, fileUrl, key, contentType }, ...]
async function putFilesToS3(presigns, fileList) {
  const files = Array.from(fileList);
  await Promise.all(
    presigns.map((p) => {
      const file = files.find((f) => f.name === p.filename);
      if (!file) return Promise.resolve();
      return fetch(p.uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": p.contentType || file.type },
        body: file,
      });
    })
  );
}
```

完成上传后（presign 流）：客户端应调用 `PUT /api/homeworks/:homeworkId` 将 `fileUrl` 列表写回 `images`/`videos`。

- B) multipart 直接上传流（单端点一次完成，服务器处理二进制）
  - 如果你把 `POST /api/uploads/create-and-presign` 的 Content-Type 设置为 `multipart/form-data`，并在表单中包含 `files` 字段（多文件）以及其它表单字段（`schoolName`、`groupName`、`is_team`、`members` 等），服务器会在同一请求中：
    1. 创建 draft homework，
    2. 对上传的每个文件进行压缩/转码（可用）并上传到 S3，
    3. 把成功的 `fileUrl` 追加到刚创建的 homework（images/videos），
    4. 返回 `homeworkId` 和 `uploaded` 数组（每项包含 filename/key/fileUrl/compressed）。
  - 适用场景：你想让服务器统一做压缩、验证或不想让前端直接跟 S3 交互。
  - curl multipart 示例（在同一请求中上传文件本体并创建 draft）：

```bash
curl -X POST "https://your-api.example.com/api/uploads/create-and-presign" \
  -F "schoolName=Sunrise School" \
  -F "groupName=Class1A" \
  -F "is_team=true" \
  -F "members[]=Alice" \
  -F "members[]=Bob" \
  -F "files=@/full/path/to/a.jpg" \
  -F "files=@/full/path/to/b.png"
```

示例响应（multipart 直接上传）

```json
{
  "homeworkId": "generated-server-uuid",
  "uploaded": [
    {
      "filename": "a.jpg",
      "key": "...",
      "fileUrl": "https://.../a.jpg",
      "compressed": true
    },
    {
      "filename": "b.png",
      "key": "...",
      "fileUrl": "https://.../b.png",
      "compressed": true
    }
  ]
}
```

说明：二进制数据在 multipart 请求的文件字段里（`files`），不是 JSON body。服务器会处理这些文件并在响应中返回上传结果。

选择建议：

- 想把上传动作交给前端并减轻服务器负担：用 A) presign 流。
- 想服务器统一做压缩/转码/验证：用 B) multipart 直接上传流（单请求完成）。

说明与注意点：

- `create-and-presign` 会把 `is_team/groupName/members/schoolName` 写入 draft homework，所以你在后续的 `PUT /api/homeworks/:id` 中可以只附加 `images`/`videos`，也可重复发送团队信息以确保完整性。
- 如果你希望上传成功后自动把 `fileUrl` 写回 homework，可以使用 S3 Events + Lambda：在 S3 对象创建事件中解析 object key（或使用 object metadata 包含 homeworkId），并调用 DynamoDB 更新逻辑。
- 浏览器直接 PUT 到 S3 时，请确保 S3 的 CORS 配置允许你的前端 origin、PUT 方法和 Content-Type header；否则浏览器会因为 CORS 而失败。

3. POST /api/uploads/upload

- Purpose: server-side upload + optional compression (image/video).
- Request: multipart/form-data - `file` (binary) - required - `homeworkId`, `filename`, `schoolName`, `groupName` - form fields (optional but used for key)
- Response (JSON): `{ key, fileUrl, location, compressed }`
- Notes: server uses `sharp` for images and `ffmpeg` for video if available in runtime. Using server-side upload allows compression but increases server resource usage.

---

### Homework CRUD endpoints

1. POST /api/homeworks

- Purpose: create a homework entry. The server will generate `id` and `created_at`.
- Request body (JSON) required fields: - `is_team` (boolean) OR allow server to infer based on `members` / `person_name`. - For team homework (`is_team: true`): `group_name` (string) and `members` (string[] non-empty) required. - For personal homework (`is_team: false`): `person_name` (string) required. - `school_name` (string) required. - At least one of `images`, `videos`, `urls` must be present and non-empty arrays.
- Response: created homework object (DynamoDB item)

Example payload:

```json
{
  "is_team": true,
  "group_name": "Class1A",
  "members": ["Alice", "Bob"],
  "school_name": "Sunrise School",
  "images": ["https://.../path/to/photo.jpg"]
}
```

2. PUT /api/homeworks/:id

- Purpose: update homework. Accepts partial patch. Model will validate merged result.
- Use to add uploaded file URLs to images/videos/urls arrays.

3. GET /api/homeworks

- Purpose: list recent homeworks (uses `homework_index` GSI). Query param: `limit`.

4. GET /api/homeworks/:id

- Purpose: get a single homework by id.

5. DELETE /api/homeworks/:id

- Purpose: delete homework item.

6. Additional listing endpoints

- GET /api/homeworks/person/:person -> list homeworks for a person (requires `person_index` GSI)
- GET /api/homeworks/group/:group -> list homeworks for a group/team (requires `group_index` GSI)
- GET /api/homeworks/school/:school -> list homeworks for a school (requires `school_index` GSI)
- GET /api/homeworks/has/images -> list homeworks with images (requires `HasImageIndex` GSI)
- GET /api/homeworks/has/videos -> list homeworks with videos (requires `HasVideosIndex` GSI)
- GET /api/homeworks/has/urls -> list homeworks with urls (requires `HasUrlsIndex` GSI)

All list endpoints accept optional `limit` query parameter (default 100).

---

## Typical client flow (presign + create-draft + upload)

1. Client calls `POST /api/uploads/create-and-presign` with `filename`, `schoolName`, `groupName`, and optional team/person metadata. Backend returns `homeworkId` + `uploadUrl` + `fileUrl`.
2. Client PUTs the file to `uploadUrl` (presigned URL).
3. Client calls `PUT /api/homeworks/:homeworkId` to add the returned `fileUrl` into `images`/`videos`/`urls` array.

Note: currently create-and-presign writes a draft homework without media. After upload, the client must update the homework to include the fileUrl so the item is considered to "have media" for GSI projections.

---

## Development

- Run locally: `npm install` then `npm run dev` (or your project scripts). Ensure `.env` has `S3_BUCKET` and `DYNAMO_TABLE` set for local testing or use mocked services.

## Notes & next steps

- Consider using S3 Events + Lambda to automatically write uploaded file URLs back into homework items to avoid an extra client update step.
- Verify DynamoDB GSI projections include the fields you need (e.g. `preview`, `person_name`). If projection omits them, index query results may not include those attributes and you'll need to BatchGet the main items.

---

If you want, I can also add a short frontend JS snippet that demonstrates the full flow (create-and-presign + PUT + update).

## Frontend example (JavaScript)

Below is a minimal browser-friendly example that:

- Calls `POST /api/uploads/create-and-presign` to create a draft and get a presigned URL;
- Uploads the file to S3 with the returned `uploadUrl` using PUT;
- Calls `PUT /api/homeworks/:homeworkId` to attach the uploaded file URL to the homework record.

```javascript
async function uploadAndAttachFile(
  file,
  { schoolName, groupName, is_team = true, members = [] } = {}
) {
  // 1) create draft and get presign
  const createResp = await fetch("/api/uploads/create-and-presign", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      filename: file.name,
      contentType: file.type,
      schoolName,
      groupName,
      is_team,
      members,
    }),
  });
  if (!createResp.ok) throw new Error("create-and-presign failed");
  const { uploadUrl, fileUrl, homeworkId } = await createResp.json();

  // 2) upload file to S3 using the presigned URL
  const putResp = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": file.type },
    body: file,
  });
  if (!putResp.ok) throw new Error("upload to S3 failed");

  // 3) attach uploaded file URL to the homework record
  const updateResp = await fetch(`/api/homeworks/${homeworkId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ images: [fileUrl] }),
  });
  if (!updateResp.ok) {
    // handle gracefully; the file is uploaded but homework update failed
    throw new Error("failed to update homework with file URL");
  }

  return { homeworkId, fileUrl };
}

// Usage example (from an <input type="file"> change handler):
// const file = event.target.files[0];
// uploadAndAttachFile(file, { schoolName: 'Sunrise School', groupName: 'Class1A', is_team: true, members: ['Alice'] })
//   .then(console.log)
//   .catch(console.error);
```

Notes:

- Ensure your S3 bucket allows the requested Content-Type and CORS for browser PUTs when using presigned URLs.
- If you use a different API base path or host, replace `/api/...` with the full origin.
- For large files consider server-side upload (POST /api/uploads/upload) or multipart upload strategies.
