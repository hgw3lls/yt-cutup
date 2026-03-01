import { cpSync, createReadStream, existsSync, statSync } from "node:fs";
import path from "node:path";
import type { Plugin } from "vite";
import { defineConfig } from "vite";

function contentTypeFor(filePath: string): string {
  if (filePath.endsWith(".json")) return "application/json; charset=utf-8";
  if (filePath.endsWith(".js")) return "application/javascript; charset=utf-8";
  if (filePath.endsWith(".css")) return "text/css; charset=utf-8";
  if (filePath.endsWith(".html")) return "text/html; charset=utf-8";
  return "application/octet-stream";
}

function transmissionsDataPlugin(): Plugin {
  const dataDir = path.resolve(process.cwd(), "data");

  return {
    name: "transmissions-data-plugin",
    configureServer(server) {
      server.middlewares.use("/data", (req, res, next) => {
        if (!req.url) {
          next();
          return;
        }

        const requestPath = decodeURIComponent(req.url.split("?")[0]).replace(/^\//, "");
        const resolvedPath = path.resolve(dataDir, requestPath);

        if (!resolvedPath.startsWith(dataDir)) {
          res.statusCode = 403;
          res.end("Forbidden");
          return;
        }

        if (!existsSync(resolvedPath)) {
          next();
          return;
        }

        const fileStat = statSync(resolvedPath);
        if (fileStat.isDirectory()) {
          next();
          return;
        }

        res.statusCode = 200;
        res.setHeader("Content-Type", contentTypeFor(resolvedPath));
        createReadStream(resolvedPath).pipe(res);
      });
    },
    closeBundle() {
      if (!existsSync(dataDir)) {
        return;
      }

      const outDir = path.resolve(process.cwd(), "dist");
      const targetDataDir = path.join(outDir, "data");
      cpSync(dataDir, targetDataDir, { recursive: true, force: true });
    },
  };
}

export default defineConfig({
  plugins: [transmissionsDataPlugin()],
});
