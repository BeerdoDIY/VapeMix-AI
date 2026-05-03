import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import * as dotenv from "dotenv";
import fs from "fs";

// Load environment variables from .env if it exists
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;
  const now = new Date().toISOString();
  
  console.log(`[${now}] [PID: ${process.pid}] Starting server in ${process.env.NODE_ENV || 'development'} mode...`);

  app.use(express.json());

  // API route to provide the Gemini API Key to the frontend at runtime
  app.get("/api/config", (req, res) => {
    // Check multiple possible environment variable names
    const apiKey = 
      process.env.GEMINI_API_KEY || 
      process.env.VITE_GEMINI_API_KEY || 
      process.env.GOOGLE_API_KEY || 
      process.env.API_KEY ||
      "";
    
    res.json({ 
      GEMINI_API_KEY: apiKey,
      isConfigured: !!apiKey
    });
  });

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    const indexPath = path.join(distPath, "index.html");
    
    // Log if dist or index.html is missing
    if (!fs.existsSync(distPath)) {
      console.error(`[PID: ${process.pid}] CRITICAL: dist directory missing at ${distPath}`);
    } else if (!fs.existsSync(indexPath)) {
      console.error(`[PID: ${process.pid}] CRITICAL: index.html missing at ${indexPath}`);
    } else {
      console.log(`[PID: ${process.pid}] Serving static files from ${distPath}`);
    }

    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(indexPath);
    });
  }

  const server = app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });

  server.on('error', (error: any) => {
    if (error.code === 'EADDRINUSE') {
      console.error(`Port ${PORT} is already in use. Exiting to allow orchestrator to restart.`);
      process.exit(1);
    } else {
      console.error('Server error:', error);
      process.exit(1);
    }
  });
}

startServer().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
