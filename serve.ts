import { join, extname } from "node:path";
import { existsSync, readFileSync } from "node:fs";

const MIME: Record<string, string> = {
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".json": "application/json",
};

type SsrHandler = { fetch: (req: Request, env: unknown, ctx: unknown) => Promise<Response> };
const ssr = (await import("./dist/server/server.js")) as { default: SsrHandler };

Bun.serve({
  port: parseInt(process.env.PORT ?? "3000"),
  async fetch(req) {
    const pathname = new URL(req.url).pathname;

    const staticPath = join("dist/client", pathname);
    if (existsSync(staticPath) && !staticPath.endsWith("/")) {
      const ext = extname(staticPath);
      return new Response(readFileSync(staticPath), {
        headers: {
          "Content-Type": MIME[ext] ?? "application/octet-stream",
          "Cache-Control": pathname.startsWith("/assets/")
            ? "public, max-age=31536000, immutable"
            : "public, max-age=0",
        },
      });
    }

    return ssr.default.fetch(req, {}, {});
  },
});

console.log(`Listening on port ${process.env.PORT ?? 3000}`);
