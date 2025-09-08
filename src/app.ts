import express from "express";
import homeworkRoutes from "./routes/homeworkRoutes.js";
import { initTable } from "./models/homework.js";

const app = express();

app.use(express.json({ limit: "10mb" }));

app.get("/api", (req, res) => {
  res.send("Hello from maxhacker api!");
});

app.use("/api/homeworks", homeworkRoutes);
import uploadRoutes from "./routes/uploadRoutes.js";
app.use("/api/uploads", uploadRoutes);

// initialize DB table (best effort)
initTable().catch((err) => console.error("initTable error", err));

export default app;
