import AWS from "aws-sdk";
import { v4 as uuidv4 } from "uuid";

export type Role = "Admin" | "Editor" | "User" | "StudentPublic";

export type UserItem = {
  id: string;
  username: string;
  display_name?: string;
  email?: string;
  password_hash?: string; // bcrypt hashed
  role: Role;
  blocked?: boolean;
  token_version?: number;
  created_at: string;
  last_login?: string;
  entityType?: string;
  PK?: string;
  SK?: string;
};

const ddb = new AWS.DynamoDB.DocumentClient({
  region: process.env.AWS_REGION || "ap-southeast-2",
});
const TABLE = process.env.DYNAMO_TABLE || "homeworks";

export async function createUser(user: Partial<UserItem>) {
  const now = new Date().toISOString();
  const id = user.id || uuidv4();
  const item: any = {
    id,
    username: String(user.username),
    display_name: user.display_name || user.username,
    email: user.email,
    password_hash: user.password_hash,
    role: (user.role as Role) || "User",
    blocked: !!user.blocked,
    token_version:
      typeof user.token_version === "number" ? user.token_version : 0,
    created_at: now,
    last_login: user.last_login,
  };
  item.PK = `USER#${item.id}`;
  item.SK = `META#${item.created_at}`;
  item.entityType = "USER";

  await ddb.put({ TableName: TABLE, Item: item }).promise();
  return item as UserItem;
}

export async function getUserById(id: string) {
  const pk = `USER#${id}`;
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

export async function getUserByUsername(username: string) {
  // scan for username - for small user base acceptable; for prod add a GSI on username
  const r = await ddb
    .scan({
      TableName: TABLE,
      FilterExpression: "username = :u",
      ExpressionAttributeValues: { ":u": username },
      Limit: 1,
    })
    .promise();
  return (r.Items && r.Items[0]) || null;
}

export async function listUsers(limit = 100) {
  const r = await ddb
    .query({
      TableName: TABLE,
      IndexName: undefined as any,
      KeyConditionExpression: "entityType = :e",
      ExpressionAttributeValues: { ":e": "USER" },
      Limit: limit,
    })
    .promise()
    .catch(async () => {
      // fallback to scan
      const s = await ddb
        .scan({
          TableName: TABLE,
          FilterExpression: "entityType = :e",
          ExpressionAttributeValues: { ":e": "USER" },
          Limit: limit,
        })
        .promise();
      return s as any;
    });
  return r.Items || [];
}

export async function updateUser(id: string, patch: Partial<UserItem>) {
  const existing = await getUserById(id);
  if (!existing) return null;
  const updated = { ...existing, ...patch } as any;
  // maintain keys
  updated.PK = `USER#${updated.id}`;
  updated.SK = `META#${updated.created_at}`;
  await ddb.put({ TableName: TABLE, Item: updated }).promise();
  return updated as UserItem;
}

export async function deleteUser(id: string) {
  const existing = await getUserById(id);
  if (!existing) return;
  await ddb
    .delete({
      TableName: TABLE,
      Key: { PK: `USER#${existing.id}`, SK: `META#${existing.created_at}` },
    })
    .promise();
}
