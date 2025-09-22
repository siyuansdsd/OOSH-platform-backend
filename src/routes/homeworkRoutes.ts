import express from "express";
import * as ctrl from "../controller/homeworkController.js";
import { authMiddleware, requireRole } from "../middleware/auth.js";

const router = express.Router();

router.use(authMiddleware);

router.post("/", requireRole("Admin", "Editor", "StudentPublic"), ctrl.create);
router.get("/", requireRole("Admin", "Editor", "StudentPublic"), ctrl.list);
// filter/list endpoints
router.get(
  "/person/:person",
  requireRole("Admin", "Editor", "StudentPublic"),
  ctrl.listByPerson
);
router.get(
  "/group/:group",
  requireRole("Admin", "Editor", "StudentPublic"),
  ctrl.listByGroup
);
router.get(
  "/school/:school",
  requireRole("Admin", "Editor", "StudentPublic"),
  ctrl.listBySchool
);
router.get(
  "/has/images",
  requireRole("Admin", "Editor", "StudentPublic"),
  ctrl.listWithImages
);
router.get(
  "/has/videos",
  requireRole("Admin", "Editor", "StudentPublic"),
  ctrl.listWithVideos
);
router.get(
  "/has/urls",
  requireRole("Admin", "Editor", "StudentPublic"),
  ctrl.listWithUrls
);
router.get("/:id", ctrl.getOne);
router.put("/:id", requireRole("Admin", "Editor"), ctrl.update);
router.delete("/:id", requireRole("Admin", "Editor"), ctrl.remove);

export default router;
