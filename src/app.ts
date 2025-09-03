import express from "express";
import homeworkRoutes from "./routes/homeworkRoutes.js";
import { initTable } from "./models/homework.js";

const app = express();

app.use(express.json({ limit: "10mb" }));

app.get("/", (req, res) => {
  res.send("Hello from Lambda!-Douglas");
});

app.use("/api/homeworks", homeworkRoutes);

// initialize DB table (best effort)
initTable().catch((err) => console.error("initTable error", err));

export default app;
