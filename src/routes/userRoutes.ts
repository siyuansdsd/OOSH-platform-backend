import express from "express";
import * as ctrl from "../controller/userController.js";
import { authMiddleware, requireRole } from "../middleware/auth.js";

const router = express.Router();

router.post("/register", ctrl.register); // create Editor/User/StudentPublic
router.post("/", authMiddleware, requireRole("Admin"), ctrl.adminCreate);
router.post("/login", ctrl.login);
router.post("/admin-login", ctrl.adminLogin);
router.post("/refresh", ctrl.refreshToken);
router.post("/logout", authMiddleware, ctrl.logout);

// admin routes
router.use(authMiddleware);
router.get("/", requireRole("Admin"), ctrl.list);
router.get("/:id", requireRole("Admin"), ctrl.getOne);
router.put("/:id", requireRole("Admin"), ctrl.update);
router.delete("/:id", requireRole("Admin"), ctrl.remove);
router.post("/:id/block", requireRole("Admin"), ctrl.blockUser);
router.post("/:id/kick", requireRole("Admin"), ctrl.kickUser);

export default router;
