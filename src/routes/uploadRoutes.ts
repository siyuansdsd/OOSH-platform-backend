import express from "express";
import multer from "multer";
import {
  presignHandler,
  uploadHandler,
} from "../controller/uploadController.js";
import { uploadMultiHandler } from "../controller/uploadController.js";
import { authMiddleware, requireRole } from "../middleware/auth.js";

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
});

router.use(authMiddleware, requireRole("Admin", "Editor", "StudentPublic"));

router.post("/presign", presignHandler);
// create draft homework + presign for client-side upload
// support both JSON presign requests and multipart file uploads on the same endpoint
const conditionalUpload = (req: any, res: any, next: any) => {
  const ct = String(req.headers["content-type"] || "");
  if (ct.startsWith("multipart/form-data")) {
    // use array middleware to accept multiple files under 'files'
    return upload.array("files", 20)(req, res, next);
  }
  return next();
};

router.post("/create-and-presign", conditionalUpload, async (req, res) => {
  const { createDraftAndPresign } = await import(
    "../controller/uploadController.js"
  );
  return createDraftAndPresign(req, res);
});
// server-side upload with compression
router.post("/upload", upload.single("file"), uploadHandler);

// server-side multi-file upload with compression
router.post("/upload-multi", upload.array("files", 20), uploadMultiHandler);

export default router;
