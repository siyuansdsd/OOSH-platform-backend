import express from "express";
import * as ctrl from "../controller/homeworkController.js";
import { authMiddleware, requireRole } from "../middleware/auth.js";

const router = express.Router();

router.get("/", authMiddleware, ctrl.list);
router.get("/person/:person", ctrl.listByPerson);
router.get("/group/:group", ctrl.listByGroup);
router.get("/school/:school", ctrl.listBySchool);
router.get("/has/images", ctrl.listWithImages);
router.get("/has/videos", ctrl.listWithVideos);
router.get("/has/urls", ctrl.listWithUrls);
router.get("/:id", ctrl.getOne);
router.post(
  "/",
  authMiddleware,
  requireRole("Admin", "Employee", "Temporary"),
  ctrl.create
);
router.put(
  "/:id",
  authMiddleware,
  requireRole("Admin", "Employee", "Temporary"),
  ctrl.update
);
router.delete(
  "/:id",
  authMiddleware,
  requireRole("Admin", "Employee"),
  ctrl.remove
);

export default router;
