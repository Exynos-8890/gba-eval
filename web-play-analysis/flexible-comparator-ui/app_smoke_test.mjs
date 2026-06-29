import { readFileSync } from "node:fs";

const root = new URL("./", import.meta.url);
const html = readFileSync(new URL("./app/index.html", root), "utf8");
const js = readFileSync(new URL("./app/app.js", root), "utf8");
const server = readFileSync(new URL("./server.mjs", root), "utf8");

for (const token of [
  "Version 6 Comparator",
  "Reference",
  "Candidate",
  "Time Offset Diff",
  "Offset Search Evidence",
  "Run search",
  "mixed_local_time_shifts",
  "top_right",
  "bottom_right",
  "frameSlider",
  "runSearchButton",
  "currentDiffCanvas",
  "alignedDiffCanvas",
]) {
  if (!html.includes(token)) {
    throw new Error(`missing expected HTML token: ${token}`);
  }
}

for (const token of [
  "detectedRegionData",
  "computeOffsetSearch",
  "renderOffsetSearch",
  "drawAlignedDiff",
  "drawCurrentDiff",
  "copyRegion",
  "candidateFrameCount",
  "temporalWindow",
]) {
  if (!js.includes(token)) {
    throw new Error(`missing expected runtime token: ${token}`);
  }
}

for (const token of [
  "demo/mixed",
  "127.0.0.1",
  "8782",
]) {
  if (!server.includes(token)) {
    throw new Error(`missing expected server token: ${token}`);
  }
}

for (const obsolete of [
  "flexible-comparator-ui/generated",
  "/api/compare",
  "Run comparison before search",
  "Replay file",
]) {
  if (html.includes(obsolete) || js.includes(obsolete) || server.includes(obsolete)) {
    throw new Error(`obsolete dynamic-comparator token is still present: ${obsolete}`);
  }
}

console.log("version6 frontend smoke test passed");
