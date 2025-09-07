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

- Purpose: create a homework draft server-side (server generates id) and return a presigned URL in one call.
- Request body (JSON): - `filename` (string) - required - `contentType` (string) - optional - `schoolName` (string) - optional - `groupName` (string) - optional - `is_team` (boolean) - optional - `person_name` (string) - optional - `members` (string[]) - optional
- Response (JSON): - `homeworkId` (string) - server-generated id for the homework draft - `uploadUrl`, `fileUrl`, `key`, `expiresIn` - same as presign

Usage: frontends that already know school/group metadata can call this endpoint. Backend will create a draft homework (without media) and return a presign so the client can upload and then update the homework with the returned fileUrl.

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

# OOSH-platform-backend
