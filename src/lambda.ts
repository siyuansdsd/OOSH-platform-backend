import serverlessExpress from "@vendia/serverless-express";
import app from "./app.js";

// TS sees the imported module as a namespace; cast to any to call it without changing logic
export const handler = (serverlessExpress as any)({ app });
