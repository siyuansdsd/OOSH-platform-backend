import type { UserItem } from "../models/user.js";
import * as userModel from "../models/user.js";

export async function recordFailedAttempt(user: UserItem) {
  const nextCount = (user.failed_login_attempts || 0) + 1;
  const patch: Partial<UserItem> = {
    failed_login_attempts: nextCount,
    last_failed_login_at: new Date().toISOString(),
  };
  if (user.role === "Admin" && nextCount >= 5) {
    patch.blocked = true;
  }
  await userModel.updateUser(user.id, patch);
  Object.assign(user, patch);
  return patch;
}

export async function resetFailedAttempts(user: UserItem) {
  if ((user.failed_login_attempts || 0) === 0 && !user.last_failed_login_at) {
    return;
  }
  const patch: Partial<UserItem> = {
    failed_login_attempts: 0,
    last_failed_login_at: null,
  };
  await userModel.updateUser(user.id, patch);
  Object.assign(user, patch);
}
