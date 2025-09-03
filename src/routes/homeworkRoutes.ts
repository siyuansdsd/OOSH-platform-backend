import express from "express";
import * as ctrl from "../controller/homeworkController.js";

const router = express.Router();

router.post("/", ctrl.create);
router.get("/", ctrl.list);
router.get("/:id", ctrl.getOne);
router.put("/:id", ctrl.update);
router.delete("/:id", ctrl.remove);

export default router;
