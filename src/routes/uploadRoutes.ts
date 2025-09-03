import express from "express";
import multer from "multer";
import {
  presignHandler,
  uploadHandler,
} from "../controller/uploadController.js";

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
});

router.post("/presign", presignHandler);
// server-side upload with compression
router.post("/upload", upload.single("file"), uploadHandler);

export default router;
