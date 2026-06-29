import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const toolDir = fileURLToPath(new URL(".", import.meta.url));
const appRoot = join(toolDir, "app");
const demoRoot = resolve(toolDir, "demo/mixed");
const port = Number(process.env.PORT || 8782);
const host = "127.0.0.1";

const mimeTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".png", "image/png"],
]);

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || `${host}:${port}`}`);
    if (req.method !== "GET" && req.method !== "HEAD") {
      return sendText(res, "Method not allowed", 405);
    }

    if (url.pathname.startsWith("/demos/mixed/")) {
      return sendFile(res, demoRoot, url.pathname.replace(/^\/demos\/mixed\//, ""), req.method);
    }

    const requested = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
    return sendFile(res, appRoot, requested, req.method);
  } catch (error) {
    return sendText(res, "Not found", 404);
  }
});

server.listen(port, host, () => {
  console.log(`Version 6 comparator UI: http://${host}:${port}/`);
});

async function sendFile(res, root, relativePath, method) {
  const filePath = resolve(root, normalize(relativePath));
  const rootPath = resolve(root);
  if (!filePath.startsWith(rootPath)) {
    return sendText(res, "Invalid path", 400);
  }

  const info = await stat(filePath).catch(() => null);
  if (!info?.isFile()) {
    return sendText(res, "Not found", 404);
  }

  res.writeHead(200, {
    "content-type": mimeTypes.get(extname(filePath)) || "application/octet-stream",
    "content-length": info.size,
    "cache-control": "no-store",
  });
  if (method === "HEAD") {
    res.end();
    return;
  }
  createReadStream(filePath).pipe(res);
}

function sendText(res, text, status) {
  res.writeHead(status, { "content-type": "text/plain; charset=utf-8" });
  res.end(text);
}
