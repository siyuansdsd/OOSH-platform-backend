import express from "express";
import * as ctrl from "../controller/homeworkController.js";

const router = express.Router();

router.post("/", ctrl.create);
router.get("/", ctrl.list);
// filter/list endpoints
router.get("/person/:person", ctrl.listByPerson);
router.get("/group/:group", ctrl.listByGroup);
router.get("/school/:school", ctrl.listBySchool);
router.get("/has/images", ctrl.listWithImages);
router.get("/has/videos", ctrl.listWithVideos);
router.get("/has/urls", ctrl.listWithUrls);
router.get("/:id", ctrl.getOne);
router.put("/:id", ctrl.update);
router.delete("/:id", ctrl.remove);

export default router;
