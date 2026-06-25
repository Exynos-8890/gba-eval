import { createReadStream, existsSync } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";

const root = resolve(new URL(".", import.meta.url).pathname);
const port = Number.parseInt(process.env.PORT || "8771", 10);

const types = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".wasm", "application/wasm"],
  [".gba", "application/octet-stream"],
  [".png", "image/png"],
  [".ico", "image/x-icon"],
]);

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url || "/", `http://${request.headers.host || "127.0.0.1"}`);
    const pathname = decodeURIComponent(url.pathname);
    const filePath = resolvePath(pathname);
    if (!filePath) {
      response.writeHead(403);
      response.end("Forbidden");
      return;
    }
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) {
      response.writeHead(404);
      response.end("Not found");
      return;
    }
    response.writeHead(200, {
      "content-type": types.get(extname(filePath)) || "application/octet-stream",
      "content-length": fileStat.size,
      "cache-control": "no-store",
      "cross-origin-embedder-policy": "credentialless",
    });
    if (request.method === "HEAD") {
      response.end();
      return;
    }
    createReadStream(filePath).pipe(response);
  } catch (error) {
    response.writeHead(404);
    response.end("Not found");
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`local play mirror: http://127.0.0.1:${port}/play`);
});

function resolvePath(pathname) {
  const normalized = normalize(pathname).replace(/^(\.\.[/\\])+/, "");
  let relative = normalized === "/" ? "index.html" : normalized.slice(1);
  if (relative === "play") relative = "index.html";
  let filePath = join(root, relative);
  if (!filePath.startsWith(root)) return null;
  if (!existsSync(filePath) && !extname(filePath)) {
    filePath = join(root, `${relative}.html`);
  }
  return filePath.startsWith(root) ? filePath : null;
}
