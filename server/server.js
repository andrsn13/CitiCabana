import "dotenv/config";
import express from "express";
import pg from "pg";
import { initializeDatabase } from "./database.js";
import { registerApi } from "./api.js";

const { Pool } = pg;
const pool = new Pool();

const app = express();
const port = 3001;

app.use(express.json());
registerApi(app, pool);

app.get("/api/hello", (request, response) => {
  response.json({ message: "Hello from your local Express server!" });
});

app.get("/api/hello/:name", (request, response) => {
  const name = request.params.name;
  response.json({ message: `Hello, ${name}!` });
});

app.post("/api/echo", (request, response) => {
  const message = request.body.message;
  response.status(201).json({ received: message });
});

app.get("/api/db-test", async (request, response) => {
  try {
    const result = await pool.query(
      "SELECT current_database() AS database_name",
    );

    response.json({ database: result.rows[0].database_name });
  } catch (error) {
    console.error("Database test failed:", error);
    response.status(500).json({ error: "Database connection failed" });
  }
});

app.post("/api/messages", async (request, response) => {
  const content = request.body.content;

  if (typeof content !== "string" || content.trim() === "") {
    return response.status(400).json({ error: "content is required" });
  }

  try {
    const result = await pool.query(
      "INSERT INTO messages (content) VALUES ($1) RETURNING id, content, created_at",
      [content.trim()],
    );

    response.status(201).json(result.rows[0]);
  } catch (error) {
    console.error("Saving message failed:", error);
    response.status(500).json({ error: "Could not save message" });
  }
});

await initializeDatabase(pool);

app.listen(port, "127.0.0.1", () => {
  console.log(`Express server listening at http://127.0.0.1:${port}`);
});
