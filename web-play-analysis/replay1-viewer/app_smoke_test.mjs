import { existsSync, readFileSync } from "node:fs";

const root = new URL("./", import.meta.url);

const expectedFiles = [
  "./README.md",
  "./server.mjs",
  "./app/index.html",
  "./app/styles.css",
  "./app/app.js",
];

for (const file of expectedFiles) {
  if (!existsSync(new URL(file, root))) {
    throw new Error(`missing expected replay viewer file: ${file}`);
  }
}

const html = readFileSync(new URL("./app/index.html", root), "utf8");
const css = readFileSync(new URL("./app/styles.css", root), "utf8");
const js = readFileSync(new URL("./app/app.js", root), "utf8");
const server = readFileSync(new URL("./server.mjs", root), "utf8");

for (const token of [
  "Replay Frame Viewer",
  "Replay 1",
  "Celeste Classic",
  "Claude Opus 4.8",
  "Reference",
  "Candidate",
  "Diff",
  "Temporal Summary",
  "Offset Search Evidence",
  "best offset from lowest error",
  "frameSlider",
  "playPause",
  "runSearchButton",
  "offsetSearchPanel",
  "referenceFrame",
  "candidateFrame",
  "diffFrame",
  "diffCanvas",
  "regionCompareCanvas",
]) {
  if (!html.includes(token)) {
    throw new Error(`missing expected HTML token: ${token}`);
  }
}

for (const token of [
  "loadReplayData",
  "runOffsetSearch",
  "renderOffsetSearch",
  "computeOffsetSearch",
  "renderSearchCard",
  "renderBar",
  "renderFrame",
  "renderRegionBoxes",
  "drawRegionComparison",
  "selectRegion",
  "copyRegion",
  "setPlaying",
  "formatFrameName",
  "temporalWindow",
  "recording.json",
  "comparator-summary.json",
  "changed_pixels",
  "global_best_offset",
  "mixed_local_time_shifts",
]) {
  if (!js.includes(token)) {
    throw new Error(`missing expected runtime token: ${token}`);
  }
}

for (const token of [
  "replay-frame-capture/generated/replay1",
  "/api/compare",
  "synthetic_compare",
  "/frames/",
  "127.0.0.1",
  "8784",
]) {
  if (!server.includes(token)) {
    throw new Error(`missing expected server token: ${token}`);
  }
}

for (const token of [
  "replay1-viewer",
  "image-rendering: pixelated",
  "viewport",
  "region-box",
  "diff-overlay",
  "comparison-canvas",
  "search-bars",
  "search-bar",
  "is-best",
]) {
  if (!css.includes(token)) {
    throw new Error(`missing expected style token: ${token}`);
  }
}

for (const obsolete of [
  "flexible-comparator-ui/demo/mixed",
  "temporal-heatmap.png",
  "temporal-region-overlay.png",
  "heatmapImage",
  "overlayImage",
  "celeste-opus-4-8-idle-60",
]) {
  if (html.includes(obsolete) || js.includes(obsolete) || server.includes(obsolete)) {
    throw new Error(`obsolete comparator token is still present: ${obsolete}`);
  }
}

console.log("replay frame viewer smoke test passed");
