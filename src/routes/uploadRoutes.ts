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
// create draft homework + presign for client-side upload
router.post("/create-and-presign", async (req, res) => {
  const { createDraftAndPresign } = await import(
    "../controller/uploadController.js"
  );
  return createDraftAndPresign(req, res);
});
// server-side upload with compression
router.post("/upload", upload.single("file"), uploadHandler);

export default router;
