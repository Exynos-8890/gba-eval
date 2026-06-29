import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const toolDir = fileURLToPath(new URL(".", import.meta.url));
const appRoot = join(toolDir, "app");
const frameRoot = resolve(
  toolDir,
  "../replay-frame-capture/generated/replay1",
);
const repoRoot = resolve(toolDir, "../..");
const port = Number(process.env.PORT || 8784);
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

    if (url.pathname === "/api/compare") {
      try {
        return sendJson(res, await runBackendCompare(), req.method);
      } catch (error) {
        return sendJson(res, { error: error.message }, req.method, 500);
      }
    }

    if (url.pathname.startsWith("/frames/")) {
      return sendFile(res, frameRoot, url.pathname.replace(/^\/frames\//, ""), req.method);
    }

    const requested = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
    return sendFile(res, appRoot, requested, req.method);
  } catch (error) {
    return sendText(res, "Not found", 404);
  }
});

server.listen(port, host, () => {
  console.log(`Replay 1 viewer: http://${host}:${port}/`);
});

async function sendFile(res, root, relativePath, method) {
  const rootPath = resolve(root);
  const filePath = resolve(rootPath, normalize(relativePath));
  if (filePath !== rootPath && !filePath.startsWith(`${rootPath}${sep}`)) {
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

function sendJson(res, data, method, status = 200) {
  const body = JSON.stringify(data, null, 2);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
  });
  if (method === "HEAD") {
    res.end();
    return;
  }
  res.end(body);
}

function runBackendCompare() {
  const args = [
    "run",
    "-p",
    "lockstep",
    "--bin",
    "synthetic_compare",
    "--",
    "--reference",
    join(frameRoot, "reference"),
    "--candidate",
    join(frameRoot, "candidate"),
    "--temporal-window",
    "5",
    "--summary-only",
  ];

  return new Promise((resolvePromise, reject) => {
    const child = spawn("cargo", args, { cwd: repoRoot, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`synthetic_compare exited ${code}: ${stderr.trim()}`));
        return;
      }
      try {
        resolvePromise(JSON.parse(stdout));
      } catch (error) {
        reject(new Error(`synthetic_compare returned invalid JSON: ${error.message}`));
      }
    });
  });
}
