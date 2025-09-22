# OOSH-platform-backend

Backend service for homework management, media uploads and presigned S3 uploads.

## Environment

Set the following environment variables (in `.env` for local dev, or in Lambda environment):

- `AWS_REGION` - AWS region (e.g. `ap-southeast-2`).
- `S3_BUCKET` - S3 bucket name used for uploads.
- `DYNAMO_TABLE` - DynamoDB table name (default: `homeworks`).
- `NODE_ENV` - (optional) `development`/`production`.
- `PORT` - (local dev) port to run express server.
- `JWT_SECRET` - secret for signing access tokens (default `dev-secret`).
- `JWT_EXPIRES_IN` - access token lifetime (default `1d`).
- `JWT_REFRESH_SECRET` - optional extra secret for refresh token hashing (falls back to `JWT_SECRET`).
- `REFRESH_TOKEN_TTL_DAYS` - refresh token lifetime in days (default `30`).

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

- Auth: Bearer token required. Allowed roles: Admin, Editor, StudentPublic.
- Purpose: get a presigned PUT URL for uploading a single file to S3.
- Request body (JSON): - `homeworkId` (string) - used to build the S3 key path (optional but recommended) - `filename` (string) - required - `contentType` (string) - optional - `schoolName` (string) - optional (used in key) - `groupName` (string) - optional (used in key)
- Response (JSON): - `uploadUrl` (string) - signed URL for PUT - `fileUrl` (string) - public S3 URL for reading - `key` (string) - S3 object key - `expiresIn` (number)

{
"homeworkId": "client-uuid-1",
"filename": "photo.jpg",
"contentType": "image/jpeg",
"schoolName": "Sunrise School",
"groupName": "Class1A"
}

```

2. POST /api/uploads/create-and-presign

- Auth: Bearer token required (Admin, Editor, StudentPublic).
- Purpose: create a homework draft server-side (server generates id) and return one or more presigned PUT URLs in one call. This endpoint is backward-compatible: it accepts a single file (old form) or multiple files (new form) and returns either a single presign or an array of presigns.
- Request body (JSON): supports three input shapes (priority order):

## Email verification (new)

本文档详细说明新增的邮件验证码功能与开放的 HTTP API，包含环境变量、依赖、权限、测试步骤与故障排查。

### 概述
- 功能：通过 Amazon SES 发送邮件验证码，并把验证码保存在 Redis（ElastiCache）中，供后端校验登录/注册或短期验证使用。验证码默认有效期 5 分钟（300 秒）。
- 流程：客户端请求 `POST /api/verify/send-code` -> 服务器生成 6 位数字验证码并写入 Redis（键 `verify:<email>`），调用 SES 发送邮件 -> 用户收到邮件并将 code 发到 `POST /api/verify/verify-code` 校验 -> 校验通过后删除 Redis 中的验证码。

### 新增依赖
- Node.js 包：`redis`（或 `ioredis` 用于 cluster）、`nodemailer`、`uuid`（已用于示例，但不是必须）。

安装示例：
```

npm install redis nodemailer uuid

```

### 环境变量
在 Lambda 或本地 `.env` 中配置：
- REDIS_HOST：ElastiCache endpoint（不带协议）
- REDIS_PORT：6379（缺省）
- REDIS_TLS：true/false（若启用了 in-transit encryption 则为 true）
- REDIS_PASSWORD：（可选，若启用 AUTH）
- REDIS_CLUSTER：true/false（可选，集群模式）
- AWS_REGION / SES_REGION：AWS 区域，例如 `ap-southeast-2`
- SES_FROM：邮件发件人（需在 SES 验证的邮箱或域，例如 `<SES_VERIFIED_FROM_EMAIL>`）
- SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASS：填写 SES SMTP Interface（或其他 SMTP 服务）的主机、端口、用户名、密码。系统现已强制走 SMTP 发送验证码；若未设置这些变量将直接报错。使用端口 587 可自动启用 STARTTLS，若使用 465/2465 记得将 `SMTP_SECURE=true`。

示例 `.env` 片段（请用你的实际值替换占位符；不要在仓库中提交真实凭证或终端节点）：
```

# 示例（使用占位符替换真实值）

REDIS_HOST=<YOUR_REDIS_ENDPOINT>
REDIS_PORT=6379
REDIS_TLS=true
REDIS_CLUSTER=false
AWS_REGION=<YOUR_AWS_REGION>
SES_FROM=<SES_VERIFIED_FROM_EMAIL>
SMTP_HOST=email-smtp.<YOUR_REGION>.amazonaws.com
SMTP_PORT=587
SMTP_USER=<SES_SMTP_USER>
SMTP_PASS=<SES_SMTP_PASSWORD>

```

### IAM 权限
- 如果在 Lambda 中运行，执行角色需要至少以下 SES 权限：
```

"ses:SendEmail",
"ses:SendRawEmail",
"ses:SendTemplatedEmail"

```
（可将 Resource 进一步限制为特定 identity ARN）

### HTTP API
- 1) 发送验证码
- 路径：POST /api/verify/send-code
- 行为：
  - 普通用户（role = `User`）：`purpose` 默认 `login`。邮箱存在时发送验证码；如果用于注册（`purpose: "register"`），邮箱不存在也可以发送。
  - Admin/Editor：必须提供邮箱 + 密码；仅在登录模式下允许（`purpose` 缺省或 `login`），注册时若账号已存在返回 409。
  - StudentPublic：不支持验证码。
- 请求体示例：
  - 登录普通用户：`{ "email": "user@example.com" }`
  - 注册普通用户：`{ "email": "newuser@example.com", "purpose": "register" }`
  - Admin/Editor 登录：`{ "email": "admin@example.com", "password": "PlainPassword" }`
- 返回：
  - 200 { "ok": true } — 发送成功
  - 400 { "error": "email required" } / { "error": "password required" }
  - 401 { "error": "invalid credentials" }
  - 403 { "error": "account blocked" } 或 `code not supported for this account`
  - 500 { "error": "send failed" } — 服务器/SES/Redis 错误

- 2) 校验验证码
- 路径：POST /api/verify/verify-code
- 行为：
  - 普通用户：
    - 登录：`{ email, code }`
    - 注册：`{ email, code, purpose: "register" }`（邮箱若已有账号返回 409）。
  - Admin/Editor：`{ email, password, code }`（仅登录流程）。
  - StudentPublic：不支持。
- 请求体示例：
  - 普通用户：`{ "email": "user@example.com", "code": "123456" }`
  - Admin/Editor：`{ "email": "admin@example.com", "password": "PlainPassword", "code": "123456" }`
- 返回：
  - 200 { "ok": true } — 验证通过
  - 400 { "error": "email and code required" } / { "error": "password required" }
  - 401 { "error": "invalid credentials" }
  - 403 { "error": "account blocked" }
  - 400 { "error": "invalid" } — 验证码不匹配或已过期
  - 500 { "error": "verify failed" } — 内部错误

示例 curl：
```

curl -X POST https://your-api.example.com/api/verify/send-code \
 -H "Content-Type: application/json" \
 -d '{"email":"you@example.com","purpose":"register"}'

curl -X POST https://your-api.example.com/api/verify/verify-code \
 -H "Content-Type: application/json" \
 -d '{"email":"you@example.com","code":"123456","purpose":"register"}'

````

### 测试步骤（本地）
1. 在 `.env` 中配置上面列出的环境变量（REDIS_* 与 SES_*）。
2. 确保可以连接 ElastiCache（如果本地无法访问 VPC 内的 ElastiCache，可在同 VPC 的 EC2 或用临时 Lambda 测试）。
3. 启动服务器（`npm run dev` 或 `node`），调用 `/api/verify/send-code`，检查终端或 CloudWatch 日志确认 SES API 返回。检查邮件收件箱。然后调用 `/api/verify/verify-code` 验证。

### 部署到 Lambda 注意事项
- 确保 Lambda 在可访问 ElastiCache 的 VPC 子网并分配正确安全组。Redis 的 Security Group 需允许来自 Lambda 的入站。
- 把同样的环境变量写入 Lambda 配置（环境变量项）。
- Lambda 执行角色需要 SES 权限。

### 常见故障与排查
- 连接超时 / Task timed out：检查 Lambda VPC、子网路由与 NAT/Endpoints；对于 Redis，确认安全组允许来自 Lambda 的入站。
- NOAUTH Authentication required：需要在 `.env` 设置 `REDIS_PASSWORD`。
- SES 发送失败：检查 SES 是否在 sandbox（沙箱）模式，若是需申请解除；确认 `SES_FROM` 已验证且 DKIM/SPF 配置正确以提高送达率。
- 邮件被标记为垃圾邮件：建议设置 DKIM（SES 提供 CNAME）、SPF（TXT include:amazonses.com）和 DMARC（先 p=none 收集报告）。

### 代码位置说明
- Redis 工具：`src/utils/redisClient.ts`
- SES 工具：`src/utils/ses.ts`
- 业务控制器：`src/controller/verificationController.ts`
- 路由注册：`src/routes/verificationRoutes.ts`，并在 `src/app.ts` 中注册 `/api/verify` 路由

---

如果你需要我把这段文档放在 `README.md` 的特定位置或生成 API 文档页面（例如 docs site），告诉我要放在哪儿我会继续操作。
  - `filenames` (string[]) — multiple filenames
  - `files` (array of objects) — multiple files with per-file contentType: [{ filename, contentType }]
  - `title` (string, required) — homework title displayed to users.
  - `description` (string, required) — short project description.
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
  "title": "Science Fair Project",
  "description": "Showcase of renewable energy prototype with build steps.",
  "schoolName": "Sunrise School",
  "groupName": "Class1A",
  "is_team": true,
  "members": ["Alice", "Bob"]
}
````

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

A) JSON presign 流（客户端负责把文件 PUT 到 S3，适合减轻服务器压力）

下面是最常见的三步流程（每步都有可直接复制的代码示例）：

1. 在后端创建 draft 并获取 presigned URL（POST -> 返回 presigns）

- 请求：
  - URL: POST /api/uploads/create-and-presign
  - Content-Type: application/json
  - Body 示例（单文件或多文件都支持）：

```json
{
  "files": [
    { "filename": "a.jpg", "contentType": "image/jpeg" },
    { "filename": "b.png", "contentType": "image/png" }
  ],
  "title": "Science Fair Project",
  "description": "Showcase of renewable energy prototype with build steps.",
  "schoolName": "Sunrise School",
  "groupName": "Class1A",
  "is_team": true,
  "members": ["Alice", "Bob"]
}
```

- Curl（获取 presigns 的示例）：

```bash
curl -s -X POST "https://your-api.example.com/api/uploads/create-and-presign" \
  -H "Content-Type: application/json" \
  -d '{"files":[{"filename":"a.jpg","contentType":"image/jpeg"},{"filename":"b.png","contentType":"image/png"}],"title":"Science Fair Project","description":"Showcase of renewable energy prototype with build steps.","schoolName":"Sunrise School","groupName":"Class1A"}'

# 响应示例（重要字段）:
# {
#   "homeworkId": "generated-server-uuid",
#   "presigns": [ {"filename":"a.jpg","uploadUrl":"https://...","fileUrl":"https://.../a.jpg","key":"...","expiresIn":900,"contentType":"image/jpeg"}, ... ]
# }
```

- 浏览器 fetch（获取 presigns）：

```javascript
const createResp = await fetch("/api/uploads/create-and-presign", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    files: [{ filename: file.name, contentType: file.type }],
    schoolName: "Sunrise School",
  }),
});
const { homeworkId, presigns } = await createResp.json();
```

2. 把每个文件的二进制 PUT 到 presign 返回的 uploadUrl（这一步在客户端执行）

- 注意：

  - 这里传的是文件二进制，不是 JSON。浏览器需要 S3 的 CORS 支持（允许你的 origin、PUT 方法和 Content-Type header）。
  - uploadUrl 是一个包含临时签名的完整 URL，直接对它发 PUT 即可。

- Curl 示例（逐个上传二进制到 presigned URL）：

```bash
# 假设你从第 1 步拿到 presigns[0].uploadUrl
curl -v -X PUT "<uploadUrl-for-a.jpg>" \
  -H "Content-Type: image/jpeg" \
  --data-binary @/full/path/to/a.jpg

# 上传第二个文件
curl -v -X PUT "<uploadUrl-for-b.png>" \
  -H "Content-Type: image/png" \
  --data-binary @/full/path/to/b.png
```

- 浏览器 fetch 示例（把前端 file input 的文件 PUT 到对应的 presign）：

```javascript
// presigns: [{ filename, uploadUrl, fileUrl, key, contentType }, ...]
// files: FileList 或 Array<File>
async function putFilesToS3UsingPresigns(presigns, files) {
  const fileArr = Array.from(files);
  // 对应 filename -> presign 匹配（按 filename 匹配）
  await Promise.all(
    presigns.map(async (p) => {
      const f = fileArr.find((x) => x.name === p.filename);
      if (!f) return; // 跳过找不到的文件
      const res = await fetch(p.uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": p.contentType || f.type },
        body: f,
      });
      if (!res.ok) throw new Error(`Upload failed for ${p.filename}`);
    })
  );
}
```

3. 把上传后的 `fileUrl` 写回 homework（后端 draft 会先生成 `homeworkId`，你需要把 fileUrl 附加到该 homework）

- 请求：
  - URL: PUT /api/homeworks/:homeworkId
  - Content-Type: application/json
  - Body 示例（将上传得到的 fileUrl 加到 images 或 videos）：

```json
{
  "images": [
    "https://your-bucket.s3.amazonaws.com/path/to/a.jpg",
    "https://your-bucket.s3.amazonaws.com/path/to/b.png"
  ]
}
```

- Curl 示例（把 fileUrl 写回 homework）：

```bash
curl -X PUT "https://your-api.example.com/api/homeworks/generated-server-uuid" \
  -H "Content-Type: application/json" \
  -d '{"images":["https://your-bucket.s3.amazonaws.com/path/to/a.jpg","https://your-bucket.s3.amazonaws.com/path/to/b.png"]}'
```

小结 / 注意事项：

- 1. 第 1 步返回的 `presigns` 中 `fileUrl` 是最终可访问的对象 URL（如果你的 bucket 是公开或通过 CloudFront 访问），也可以当作写回 homework 的值。
- 2. 浏览器直接 PUT 到 S3 时，必须保证 S3 的 CORS 配置允许你当前的前端 origin、PUT 方法和 Content-Type header；否则浏览器会因 CORS 而失败。
- 3. 如果你用 Node 环境（非浏览器）去 PUT 二进制，有些 fetch 实现需要 `duplex: "half"` 才能发送流（只在 Node fetch/undici 下需要，浏览器不需要）。
- 4. 若你希望服务器统一做压缩/转码/验证，可使用 multipart 单端点（B) multipart 直接上传流）。

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

- `create-and-presign` 会把 `title/description/is_team/groupName/members/schoolName` 写入 draft homework，所以你在后续的 `PUT /api/homeworks/:id` 中可以只附加 `images`/`videos`，也可重复发送团队信息以确保完整性。
- 如果你希望上传成功后自动把 `fileUrl` 写回 homework，可以使用 S3 Events + Lambda：在 S3 对象创建事件中解析 object key（或使用 object metadata 包含 homeworkId），并调用 DynamoDB 更新逻辑。
- 浏览器直接 PUT 到 S3 时，请确保 S3 的 CORS 配置允许你的前端 origin、PUT 方法和 Content-Type header；否则浏览器会因为 CORS 而失败。

3. POST /api/uploads/upload

- Auth: Bearer token required (Admin, Editor, StudentPublic).
- Purpose: server-side upload + optional compression (image/video).
- Request: multipart/form-data - `file` (binary) - required - `homeworkId`, `filename`, `schoolName`, `groupName` - form fields (optional but used for key)
- Response (JSON): `{ key, fileUrl, location, compressed }`
- Notes: server uses `sharp` for images and `ffmpeg` for video if available in runtime. Using server-side upload allows compression but increases server resource usage.

---

### Homework CRUD endpoints

1. POST /api/homeworks

- Purpose: create a homework entry. The server will generate `id` and `created_at`.
- Auth: Bearer token required. Roles: Admin, Editor, StudentPublic.
- Request body (JSON) required fields:
  - `title` (string)
  - `description` (string)
  - `is_team` (boolean) OR allow server to infer based on `members` / `person_name`
  - For team homework (`is_team: true`): `group_name` (string) and `members` (string[] non-empty)
  - For personal homework (`is_team: false`): `person_name` (string)
  - `school_name` (string)
  - At least one of `images`, `videos`, `urls` must be present and non-empty arrays
- Response: created homework object (DynamoDB item)

Example payload:

```json
{
  "title": "Science Fair Project",
  "description": "Showcase of renewable energy prototype with build steps.",
  "is_team": true,
  "group_name": "Class1A",
  "members": ["Alice", "Bob"],
  "school_name": "Sunrise School",
  "images": ["https://.../path/to/photo.jpg"]
}
```

2. PUT /api/homeworks/:id

- Purpose: update homework. Accepts partial patch. Model will validate merged result.
- Auth: Bearer token required. Roles: Admin, Editor.
- Use to add uploaded file URLs to images/videos/urls arrays.

3. GET /api/homeworks

- Purpose: list recent homeworks (uses `homework_index` GSI). Query param: `limit`.
- Auth: Bearer token required. Roles: Admin, Editor, StudentPublic.

4. GET /api/homeworks/:id

- Purpose: get a single homework by id.
- Auth: Bearer token required (all logged-in roles).

5. DELETE /api/homeworks/:id

- Purpose: delete homework item.
- Auth: Bearer token required. Roles: Admin, Editor.

6. Additional listing endpoints

- GET /api/homeworks/person/:person -> list homeworks for a person (requires `person_index` GSI). Auth roles: Admin, Editor, StudentPublic.
- GET /api/homeworks/group/:group -> list homeworks for a group/team (requires `group_index` GSI). Auth roles: Admin, Editor, StudentPublic.
- GET /api/homeworks/school/:school -> list homeworks for a school (requires `school_index` GSI). Auth roles: Admin, Editor, StudentPublic.
- GET /api/homeworks/has/images -> list homeworks with images (requires `HasImageIndex` GSI). Auth roles: Admin, Editor, StudentPublic.
- GET /api/homeworks/has/videos -> list homeworks with videos (requires `HasVideosIndex` GSI). Auth roles: Admin, Editor, StudentPublic.
- GET /api/homeworks/has/urls -> list homeworks with urls (requires `HasUrlsIndex` GSI). Auth roles: Admin, Editor, StudentPublic.

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

---

## Users & Roles (新增加)

我们新增了 `User` 模型和基于角色的权限系统，支持以下角色：

- Admin — 全权限：可以登陆用户页面、登陆 admin 平台、创建/删除/修改用户、踢出登录状态、block 账户、查看所有用户并更改所有资源权限。
- Editor — 内容编辑权限：可以登陆用户页面、登陆 admin 平台，上传/修改内容，但**不能**管理用户（新增/删除/block 等）。
- User — 只读普通用户：只能查看 homework，不能登录 admin 平台，不能查看其他用户信息。
- StudentPublic — 学生公共账号：只能上传（create）和读取 homework，但不能查看或修改别人账号。

主要 API（基于 JWT）:

- `POST /api/users/register` — 注册 Editor/User/StudentPublic。User 角色可省略密码，其他角色必须提供。
- `POST /api/users/login` —
  - User：`{ email, code }`（邮箱验证码登录）。
  - StudentPublic（临时账号）：`{ username, password }`。
  返回 `{ token, expiresIn: "1d", refreshToken, refreshTokenExpiresAt, user }`。
- `POST /api/users/admin-login` — 管理后台登录，仅允许 Admin 与 Editor；请求体 `{ username, password, code }`，返回同上且 `user.scope = "admin"`。
- `POST /api/users/refresh` — 使用 refresh token 换取新的 access token。请求体：`{ refreshToken, scope? }`，`scope` 可选为 `admin`（仅 Admin/Editor 可用）。
- `POST /api/users/logout` — 需携带 Bearer Token；清除当前账户的 refresh token，并通过自增 token_version 立刻失效现有 access token。
- `POST /api/users` — Admin 专用：创建任意角色（包括 Admin）。需要 Authorization: Bearer <token>。
- `GET /api/users` — Admin 专用：列出所有用户。
- `GET /api/users/:id` — Admin 专用：查看用户详情。
- `PUT /api/users/:id` — Admin 专用：更新用户（可改 role、blocked 等）。
- `DELETE /api/users/:id` — Admin 专用：删除用户。
- `POST /api/users/:id/block` — Admin 专用：block/unblock 账户。

> Access token 默认有效期 1 天（可通过 `JWT_EXPIRES_IN` 调整）。Refresh token 默认 3 天（`REFRESH_TOKEN_TTL_DAYS` 可调）。Admin 账户在任意登录/验证码接口连续输错 5 次密码会被自动封禁；成功登录或验证后失败次数会被重置为 0。

鉴权规则（简表）：

- Admin: 所有权限。
- Editor: 除了账户管理（新增、删除、改动、查看、block、踢出登录）外，拥有上传/修改内容权限。
- User: 只能对 homework 做 Read（不可查看其他用户信息）。
- StudentPublic: 对 homework 有 Read 和 Create 权限（仅限 homework，不可查看其他用户信息）。

实现细节：

- 使用 DynamoDB 存储用户（同一 table，entityType="USER"）。
- 密码使用 `bcryptjs` 哈希，登录返回 JWT（`JWT_SECRET` 环境变量，默认 dev-secret）。
- `POST /api/users/register` 只允许创建 Editor/User/StudentPublic；Admin 必须由已有 Admin 使用 `POST /api/users` 创建。

### Account / Token revoke（踢出登录）

为了支持 Admin 强制把某个用户登出（踢出）或使已签发的 token 失效，服务端使用 `token_version` 机制：

- 每个用户记录包含 `token_version`（整数，默认 0）。
- 登录时服务端在 JWT 的 payload 中包含 `token_version`（例如 { id, username, role, token_version }）。
- 中间件在验证 JWT 后，会读取用户最新的 `token_version` 并与 token 中的 `token_version` 比对：若不一致则认为 token 已被撤销，拒绝访问并返回 401/403。

Admin 可以通过下列接口强制更新用户的 `token_version`（实现踢出效果）或封禁账户：

- `POST /api/users/:id/kick` — Admin 专用：把目标用户的 `token_version` 自增（使所有先前签发的 token 失效）。
- `POST /api/users/:id/block` — Admin 专用：把目标用户 `blocked` 置为 true，用户将无法登录或使用 API。

客户端常见操作：

- 用户主动登出：客户端直接删除本地保存的 token（cookie/localStorage）。服务器端无需操作，除非希望立即失效，请求 Admin 路径或提供用户注销接口来增加 `token_version`。
- 管理员踢出：调用 `POST /api/users/:id/kick`，响应成功后被踢用户的任何后续请求会因为 `token_version` 不匹配而被拒绝，需要重新登录获取新 token。

示例 curl：

1. 登录并获取 token（示例）

```bash
curl -s -X POST "https://your-api.example.com/api/users/login" \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"secret"}'

# 响应示例: {
#   "token": "ey...",
#   "expiresIn": "1d",
#   "refreshToken": "userId.4c0f...",
#   "refreshTokenExpiresAt": "2025-10-01T12:00:00.000Z",
#   "user": { "id": "...", "role": "Admin" }
# }
```

2. Admin 踢出某用户（把 token_version +1）

```bash
curl -X POST "https://your-api.example.com/api/users/<userId>/kick" \
  -H "Authorization: Bearer <ADMIN_TOKEN>" \
  -H "Content-Type: application/json"
```

3. 被踢用户的请求会被拒绝（示例 fetch）

```javascript
const res = await fetch("/api/homeworks", {
  headers: { Authorization: `Bearer ${token}` },
});
if (res.status === 401 || res.status === 403) {
  // token 被撤销或权限不足 —— 需要重新登录
}
```

注意：

- token_version 方案简单可靠，适用于短期会话失效场景。若需要全局 token 黑名单或跨实例即时失效，也可实现集中黑名单（例如 Redis）或在 token 中加入 `token_version` 的同时在用户表之外维护撤销列表。
- `token_version` 增加只影响已经签发的 token，后续登录会签发包含新 `token_version` 的新 token。

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
