import express from "express";
import { presignHandler } from "../controller/uploadController.js";

const router = express.Router();

router.post("/presign", presignHandler);

export default router;
