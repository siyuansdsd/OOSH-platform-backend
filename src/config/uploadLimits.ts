const DEFAULT_MAX_FILES = 30;
const GIGABYTE = 1024 * 1024 * 1024;
const DEFAULT_TOTAL_BYTES = Math.round(1.1 * GIGABYTE);

export const UPLOAD_MAX_FILES = Number(
  process.env.UPLOAD_MAX_FILES || DEFAULT_MAX_FILES
);

export const UPLOAD_MAX_TOTAL_BYTES = Number(
  process.env.UPLOAD_MAX_TOTAL_BYTES || DEFAULT_TOTAL_BYTES
);

export const UPLOAD_SINGLE_FILE_MAX_BYTES = Number(
  process.env.UPLOAD_SINGLE_FILE_MAX_BYTES || UPLOAD_MAX_TOTAL_BYTES
);

if (Number.isNaN(UPLOAD_MAX_FILES) || UPLOAD_MAX_FILES <= 0) {
  throw new Error("UPLOAD_MAX_FILES must be a positive number");
}

if (
  Number.isNaN(UPLOAD_MAX_TOTAL_BYTES) ||
  UPLOAD_MAX_TOTAL_BYTES <= 0 ||
  !Number.isFinite(UPLOAD_MAX_TOTAL_BYTES)
) {
  throw new Error("UPLOAD_MAX_TOTAL_BYTES must be a positive finite number");
}

if (
  Number.isNaN(UPLOAD_SINGLE_FILE_MAX_BYTES) ||
  UPLOAD_SINGLE_FILE_MAX_BYTES <= 0 ||
  !Number.isFinite(UPLOAD_SINGLE_FILE_MAX_BYTES)
) {
  throw new Error(
    "UPLOAD_SINGLE_FILE_MAX_BYTES must be a positive finite number"
  );
}
