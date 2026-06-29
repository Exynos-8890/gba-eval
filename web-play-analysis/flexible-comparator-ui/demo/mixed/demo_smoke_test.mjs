import { readFileSync } from "node:fs";

const html = readFileSync(new URL("./mixed-timing-demo.html", import.meta.url), "utf8");

for (const token of [
  "Reference",
  "Candidate",
  "Time Offset Diff",
  "Lockstep t+0",
  "Offset-corrected diff",
  "Offset Search Evidence",
  "best offset from lowest error",
  "Run search",
  "runSearchButton",
  "searchStatus",
  "searchHasRun",
  "updateSummaryAfterSearch",
  "formatOffset",
  "offsetSearchPanel",
  "searchBars",
  "computeOffsetSearch",
  "renderOffsetSearch",
  "drawOffsetGuide",
  "drawAlignedDiff",
  "loadCandidateFrame",
  "detectedRegionData",
  "detectedRegions",
  "local_offsets",
  "JSON.parse",
  "currentDiffCanvas",
  "alignedDiffCanvas",
  "mixed_local_time_shifts",
  "top_right",
  "bottom_right",
  "candidateFrameCount = 30",
  "playPause",
  "frameSlider",
]) {
  if (!html.includes(token)) {
    throw new Error(`missing expected demo token: ${token}`);
  }
}

for (const token of [
  "Temporal Overlay",
  "Sequence Heatmap",
  "temporalOverlayCanvas",
  "temporal-heatmap.png",
  "topMatchFrame",
  "bottomMatchFrame",
  "offset +5 frames",
  "offset -4 frames",
  "offset +2 frames",
  "offset -1 frame",
  "const offsetRegions = [",
  "offsetRegionMarkers",
  "time offset regions",
]) {
  if (html.includes(token)) {
    throw new Error(`obsolete comparison view is still present: ${token}`);
  }
}

console.log("demo smoke test passed");
