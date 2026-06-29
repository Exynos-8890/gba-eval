const frameBaseUrl = "/frames";
const targetFps = 12;
const temporalWindow = 5;

const elements = {
  classification: document.querySelector("#classification"),
  summaryLabel: document.querySelector("#summaryLabel"),
  globalOffset: document.querySelector("#globalOffset"),
  firstDiverge: document.querySelector("#firstDiverge"),
  changedPixels: document.querySelector("#changedPixels"),
  referenceFrame: document.querySelector("#referenceFrame"),
  candidateFrame: document.querySelector("#candidateFrame"),
  diffFrame: document.querySelector("#diffFrame"),
  diffCanvas: document.querySelector("#diffCanvas"),
  regionBoxLayer: document.querySelector("#regionBoxLayer"),
  referenceLabel: document.querySelector("#referenceLabel"),
  candidateLabel: document.querySelector("#candidateLabel"),
  diffLabel: document.querySelector("#diffLabel"),
  playPause: document.querySelector("#playPause"),
  runSearchButton: document.querySelector("#runSearchButton"),
  searchStatus: document.querySelector("#searchStatus"),
  frameSlider: document.querySelector("#frameSlider"),
  frameReadout: document.querySelector("#frameReadout"),
  offsetSearchPanel: document.querySelector("#offsetSearchPanel"),
  selectedRegionLabel: document.querySelector("#selectedRegionLabel"),
  regionCompareCanvas: document.querySelector("#regionCompareCanvas"),
};

let recording = null;
let comparatorSummary = null;
let frame = 0;
let playing = false;
let timer = null;
let selectedRegionIndex = 0;
let offsetSearchResults = [];
const frameImageCache = new Map();
const diffContext = elements.diffCanvas.getContext("2d");
const regionCompareContext = elements.regionCompareCanvas.getContext("2d", { willReadFrequently: true });
const referenceScratch = document.createElement("canvas");
const candidateScratch = document.createElement("canvas");
referenceScratch.width = candidateScratch.width = 240;
referenceScratch.height = candidateScratch.height = 160;
const referenceScratchContext = referenceScratch.getContext("2d", { willReadFrequently: true });
const candidateScratchContext = candidateScratch.getContext("2d", { willReadFrequently: true });

loadReplayData().catch((error) => {
  elements.summaryLabel.textContent = "load failed";
  elements.classification.textContent = error.message;
  console.error(error);
});

elements.playPause.addEventListener("click", () => {
  setPlaying(!playing);
});

elements.frameSlider.addEventListener("input", () => {
  frame = Number(elements.frameSlider.value);
  renderFrame();
});

elements.runSearchButton.addEventListener("click", () => {
  runOffsetSearch();
});

async function loadReplayData() {
  const [recordingResponse, summaryResponse] = await Promise.all([
    fetch(`${frameBaseUrl}/recording.json`),
    fetch(`${frameBaseUrl}/comparator-summary.json`),
  ]);

  if (!recordingResponse.ok) {
    throw new Error(`recording.json ${recordingResponse.status}`);
  }
  if (!summaryResponse.ok) {
    throw new Error(`comparator-summary.json ${summaryResponse.status}`);
  }

  recording = await recordingResponse.json();
  comparatorSummary = await summaryResponse.json();

  const maxFrame = Math.max(0, Number(recording.captured_frames || 1) - 1);
  elements.frameSlider.max = String(maxFrame);
  elements.frameReadout.textContent = `0 / ${maxFrame}`;

  renderSummary();
  renderOffsetSearch("Loaded saved comparison");
  renderFrame();
  runOffsetSearch({ automatic: true });
}

async function runOffsetSearch(options = {}) {
  const label = options.automatic ? "Auto search running" : "Search running";
  elements.searchStatus.textContent = `${label} through backend comparator...`;
  elements.runSearchButton.disabled = true;

  try {
    const response = await fetch("/api/compare");
    if (!response.ok) {
      throw new Error(`/api/compare ${response.status}`);
    }
    comparatorSummary = await response.json();
    selectedRegionIndex = 0;
    offsetSearchResults = [];
    renderSummary();
    await renderOffsetSearch("Backend comparison complete", { computeBars: true });
    renderRegionBoxes();
    drawRegionComparison();
  } catch (error) {
    elements.searchStatus.textContent = `Backend compare failed: ${error.message}`;
  } finally {
    elements.runSearchButton.disabled = false;
  }
}

function renderSummary() {
  const temporal = comparatorSummary.temporal_summary || {};
  const classification = temporal.classification || "unknown";
  elements.classification.textContent = classification;
  elements.summaryLabel.textContent = classification === "mixed_local_time_shifts"
    ? "mixed_local_time_shifts"
    : classification;
  elements.globalOffset.textContent = formatOffset(temporal.global_best_offset);
  elements.firstDiverge.textContent = formatOptionalFrame(comparatorSummary.first_diverge_frame);
}

async function renderOffsetSearch(status = "Comparison loaded", options = {}) {
  const regions = comparatorSummary.temporal_summary?.local_offsets || [];
  elements.searchStatus.textContent = `${status} / ${regions.length} detected regions`;

  if (!regions.length) {
    elements.offsetSearchPanel.innerHTML = '<div class="offset-row"><strong>No local offsets</strong><span>none detected</span></div>';
    return;
  }

  if (options.computeBars) {
    elements.offsetSearchPanel.innerHTML = `<div class="search-card">Scanning offsets -${temporalWindow}..+${temporalWindow}</div>`;
    offsetSearchResults = [];
    for (let index = 0; index < regions.length; index += 1) {
      const offsets = await computeOffsetSearch(regions[index]);
      offsetSearchResults.push({ regionIndex: index, offsets });
      elements.searchStatus.textContent = `Scanning region ${index + 1}/${regions.length} over -${temporalWindow}..+${temporalWindow}`;
    }
    elements.searchStatus.textContent = `Search complete over -${temporalWindow}..+${temporalWindow}; best offset from lowest error`;
  }

  if (offsetSearchResults.length) {
    elements.offsetSearchPanel.replaceChildren(...regions.map((region, index) => renderSearchCard(region, index)));
  } else {
    elements.offsetSearchPanel.replaceChildren(...regions.map((region, index) => renderOffsetRow(region, index)));
  }
  selectRegion(Math.min(selectedRegionIndex, Math.max(0, regions.length - 1)), { skipListRender: true });
  updateActiveSearchCard();
}

function renderOffsetRow(region, index) {
  const row = document.createElement("div");
  row.className = "offset-row";
  row.addEventListener("click", () => selectRegion(index));

  const body = document.createElement("div");
  const title = document.createElement("strong");
  title.textContent = region.location_label || "region";
  const details = document.createElement("span");
  details.textContent = `${region.width}x${region.height} @ ${region.x},${region.y} / confidence ${formatRatio(region.mean_confidence)}`;
  body.append(title, details);

  const badge = document.createElement("div");
  badge.className = "offset-badge";
  badge.textContent = formatOffset(region.offset);

  row.append(body, badge);
  return row;
}

async function computeOffsetSearch(region) {
  const offsets = [];
  const frameCount = Number(recording?.captured_frames || 0);
  const width = Number(recording?.width || 240);

  for (let offset = -temporalWindow; offset <= temporalWindow; offset += 1) {
    let changedPixels = 0;
    let totalPixels = 0;
    let comparedFrames = 0;

    for (let referenceIndex = 0; referenceIndex < frameCount; referenceIndex += 1) {
      const candidateIndex = referenceIndex + offset;
      if (candidateIndex < 0 || candidateIndex >= frameCount) {
        continue;
      }

      const [referenceImage, candidateImage] = await Promise.all([
        loadFrameImage("reference", referenceIndex),
        loadFrameImage("candidate", candidateIndex),
      ]);
      referenceScratchContext.drawImage(referenceImage, 0, 0, width, Number(recording.height || 160));
      candidateScratchContext.drawImage(candidateImage, 0, 0, width, Number(recording.height || 160));
      const referencePixels = referenceScratchContext.getImageData(region.x, region.y, region.width, region.height);
      const candidatePixels = candidateScratchContext.getImageData(region.x, region.y, region.width, region.height);

      for (let pixel = 0; pixel < referencePixels.data.length; pixel += 4) {
        const dr = Math.abs(referencePixels.data[pixel] - candidatePixels.data[pixel]);
        const dg = Math.abs(referencePixels.data[pixel + 1] - candidatePixels.data[pixel + 1]);
        const db = Math.abs(referencePixels.data[pixel + 2] - candidatePixels.data[pixel + 2]);
        if (dr + dg + db > 24) {
          changedPixels += 1;
        }
        totalPixels += 1;
      }
      comparedFrames += 1;
    }

    offsets.push({
      offset,
      error: totalPixels > 0 ? changedPixels / totalPixels : 1,
      comparedFrames,
    });
  }
  return offsets;
}

function renderSearchCard(region, index) {
  const result = offsetSearchResults.find((item) => item.regionIndex === index);
  const offsets = result?.offsets || [];
  const best = bestOffset(offsets);
  const worstError = Math.max(...offsets.map((item) => item.error), 0.001);

  const card = document.createElement("button");
  card.type = "button";
  card.className = `search-card${index === selectedRegionIndex ? " active" : ""}`;
  card.addEventListener("click", () => selectRegion(index));

  const title = document.createElement("div");
  title.className = "search-card-title";
  const name = document.createElement("span");
  name.textContent = region.location_label || "region";
  const bestLabel = document.createElement("span");
  bestLabel.textContent = best ? `best t${formatSigned(best.offset)}` : "not searched";
  title.append(name, bestLabel);

  const bars = document.createElement("div");
  bars.className = "search-bars";
  for (const item of offsets) {
    bars.append(renderBar(item, best, worstError));
  }

  card.append(title, bars);
  return card;
}

function renderBar(item, best, worstError) {
  const isBest = best && item.offset === best.offset;
  const bar = document.createElement("div");
  bar.className = `search-bar${isBest ? " is-best" : ""}`;
  bar.title = `offset ${formatSigned(item.offset)}, error ${item.error.toFixed(4)}, ${item.comparedFrames} frames`;

  const fill = document.createElement("div");
  fill.className = "search-bar-fill";
  fill.style.height = `${8 + (item.error / worstError) * 98}px`;
  const label = document.createElement("div");
  label.className = "search-bar-label";
  label.textContent = formatSigned(item.offset);

  bar.append(fill, label);
  return bar;
}

function bestOffset(offsets) {
  if (!offsets.length) {
    return null;
  }
  return offsets.reduce((currentBest, item) => {
    if (item.error < currentBest.error) {
      return item;
    }
    if (item.error === currentBest.error && Math.abs(item.offset) < Math.abs(currentBest.offset)) {
      return item;
    }
    return currentBest;
  }, offsets[0]);
}

function renderFrame() {
  if (!recording) {
    return;
  }

  const maxFrame = Number(recording.captured_frames || 1) - 1;
  frame = Math.max(0, Math.min(frame, maxFrame));
  const fileName = formatFrameName(frame);
  const data = recording.per_frame?.[frame] || {};

  elements.referenceFrame.src = `${frameBaseUrl}/reference/${fileName}`;
  elements.candidateFrame.src = `${frameBaseUrl}/candidate/${fileName}`;
  elements.diffFrame.src = `${frameBaseUrl}/diff/${fileName}`;

  elements.referenceLabel.textContent = fileName;
  elements.candidateLabel.textContent = fileName;
  elements.diffLabel.textContent = fileName;
  elements.changedPixels.textContent = formatPixels(data.changed_pixels);
  elements.frameSlider.value = String(frame);
  elements.frameReadout.textContent = `${frame} / ${maxFrame}`;
  renderRegionBoxes();
  drawRegionComparison();
}

function renderRegionBoxes() {
  const regions = comparatorSummary?.temporal_summary?.local_offsets || [];
  const width = Number(recording?.width || 240);
  const height = Number(recording?.height || 160);
  diffContext.clearRect(0, 0, elements.diffCanvas.width, elements.diffCanvas.height);
  elements.regionBoxLayer.replaceChildren();

  regions
    .map((region, index) => ({ region, index, area: region.width * region.height }))
    .sort((a, b) => b.area - a.area)
    .forEach(({ region, index }) => {
      const x = region.x / width;
      const y = region.y / height;
      const w = region.width / width;
      const h = region.height / height;

      diffContext.strokeStyle = index === selectedRegionIndex ? "#ffbc65" : "#69a7ff";
      diffContext.lineWidth = index === selectedRegionIndex ? 3 : 2;
      diffContext.strokeRect(region.x + 0.5, region.y + 0.5, region.width - 1, region.height - 1);

      const box = document.createElement("button");
      box.type = "button";
      box.className = `region-box${index === selectedRegionIndex ? " active" : ""}`;
      box.style.left = `${x * 100}%`;
      box.style.top = `${y * 100}%`;
      box.style.width = `${w * 100}%`;
      box.style.height = `${h * 100}%`;
      box.style.zIndex = String(Math.round(100000 - region.width * region.height));
      box.setAttribute("aria-label", `${region.location_label || "region"} ${formatOffset(region.offset)}`);
      box.addEventListener("click", () => selectRegion(index));
      elements.regionBoxLayer.append(box);
    });
}

function selectRegion(index, options = {}) {
  const regions = comparatorSummary?.temporal_summary?.local_offsets || [];
  if (!regions.length) {
    selectedRegionIndex = 0;
    elements.selectedRegionLabel.textContent = "none";
    return;
  }
  selectedRegionIndex = Math.max(0, Math.min(index, regions.length - 1));
  const region = regions[selectedRegionIndex];
  elements.selectedRegionLabel.textContent = `${region.location_label || "region"} ${formatOffset(region.offset)}`;
  if (!options.skipListRender) {
    updateActiveSearchCard();
  }
  renderRegionBoxes();
  drawRegionComparison();
}

function updateActiveSearchCard() {
  for (const card of elements.offsetSearchPanel.querySelectorAll(".search-card, .offset-row")) {
    card.classList.remove("active");
  }
  const active = elements.offsetSearchPanel.children[selectedRegionIndex];
  active?.classList.add("active");
}

async function drawRegionComparison() {
  if (!recording || !comparatorSummary) {
    return;
  }
  const region = comparatorSummary.temporal_summary?.local_offsets?.[selectedRegionIndex];
  const context = regionCompareContext;
  context.clearRect(0, 0, elements.regionCompareCanvas.width, elements.regionCompareCanvas.height);
  context.fillStyle = "#050609";
  context.fillRect(0, 0, elements.regionCompareCanvas.width, elements.regionCompareCanvas.height);

  if (!region) {
    drawCanvasLabel(context, "No region selected", 24, 40);
    return;
  }

  const candidateFrameIndex = clampFrame(frame + Number(region.offset || 0));
  const [referenceImage, candidateImage] = await Promise.all([
    loadFrameImage("reference", frame),
    loadFrameImage("candidate", candidateFrameIndex),
  ]);

  const cellWidth = 220;
  const cellHeight = 150;
  const y = 46;
  const columns = [
    { label: `Reference frame ${frame}`, x: 20 },
    { label: `Candidate frame ${candidateFrameIndex}`, x: 250 },
    { label: `Aligned diff ${formatOffset(region.offset)}`, x: 480 },
  ];

  drawCanvasLabel(context, columns[0].label, columns[0].x, 26);
  drawCanvasLabel(context, columns[1].label, columns[1].x, 26);
  drawCanvasLabel(context, columns[2].label, columns[2].x, 26);

  copyRegion(context, referenceImage, region, columns[0].x, y, cellWidth, cellHeight);
  copyRegion(context, candidateImage, region, columns[1].x, y, cellWidth, cellHeight);
  drawAlignedDiff(context, referenceImage, candidateImage, region, columns[2].x, y, cellWidth, cellHeight);
}

function copyRegion(context, image, region, x, y, width, height) {
  context.imageSmoothingEnabled = false;
  context.drawImage(image, region.x, region.y, region.width, region.height, x, y, width, height);
  context.strokeStyle = "#333b49";
  context.lineWidth = 2;
  context.strokeRect(x, y, width, height);
}

function drawAlignedDiff(context, referenceImage, candidateImage, region, x, y, width, height) {
  const scratch = document.createElement("canvas");
  scratch.width = region.width;
  scratch.height = region.height;
  const scratchContext = scratch.getContext("2d", { willReadFrequently: true });
  scratchContext.drawImage(referenceImage, region.x, region.y, region.width, region.height, 0, 0, region.width, region.height);
  const referenceData = scratchContext.getImageData(0, 0, region.width, region.height);
  scratchContext.clearRect(0, 0, region.width, region.height);
  scratchContext.drawImage(candidateImage, region.x, region.y, region.width, region.height, 0, 0, region.width, region.height);
  const candidateData = scratchContext.getImageData(0, 0, region.width, region.height);

  for (let i = 0; i < referenceData.data.length; i += 4) {
    const delta = Math.max(
      Math.abs(referenceData.data[i] - candidateData.data[i]),
      Math.abs(referenceData.data[i + 1] - candidateData.data[i + 1]),
      Math.abs(referenceData.data[i + 2] - candidateData.data[i + 2]),
    );
    referenceData.data[i] = delta > 0 ? 255 : 16;
    referenceData.data[i + 1] = delta > 0 ? 188 : 18;
    referenceData.data[i + 2] = delta > 0 ? 101 : 24;
    referenceData.data[i + 3] = 255;
  }

  scratchContext.putImageData(referenceData, 0, 0);
  context.imageSmoothingEnabled = false;
  context.drawImage(scratch, 0, 0, region.width, region.height, x, y, width, height);
  context.strokeStyle = "#333b49";
  context.lineWidth = 2;
  context.strokeRect(x, y, width, height);
}

function drawCanvasLabel(context, text, x, y) {
  context.fillStyle = "#f0f4fa";
  context.font = "14px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
  context.fillText(text, x, y);
}

function loadFrameImage(kind, index) {
  const safeIndex = clampFrame(index);
  const cacheKey = `${kind}:${safeIndex}`;
  if (frameImageCache.has(cacheKey)) {
    return frameImageCache.get(cacheKey);
  }

  const image = new Image();
  image.decoding = "async";
  const promise = new Promise((resolvePromise, reject) => {
    image.onload = () => resolvePromise(image);
    image.onerror = () => reject(new Error(`failed to load ${kind} ${safeIndex}`));
    image.src = `${frameBaseUrl}/${kind}/${formatFrameName(safeIndex)}`;
  });
  frameImageCache.set(cacheKey, promise);
  return promise;
}

function clampFrame(index) {
  const maxFrame = Number(recording?.captured_frames || 1) - 1;
  return Math.max(0, Math.min(Number(index), maxFrame));
}

function setPlaying(nextPlaying) {
  playing = nextPlaying;
  elements.playPause.textContent = playing ? "Pause" : "Play";

  if (timer) {
    clearInterval(timer);
    timer = null;
  }

  if (!playing) {
    return;
  }

  timer = setInterval(() => {
    const maxFrame = Number(recording?.captured_frames || 1) - 1;
    frame = frame >= maxFrame ? 0 : frame + 1;
    renderFrame();
  }, 1000 / targetFps);
}

function formatFrameName(index) {
  return `frame_${String(index).padStart(4, "0")}.png`;
}

function formatOffset(value) {
  if (value === null || value === undefined) {
    return "--";
  }
  return `${value > 0 ? "+" : ""}${value} frames`;
}

function formatSigned(value) {
  return `${value > 0 ? "+" : ""}${value}`;
}

function formatOptionalFrame(value) {
  if (value === null || value === undefined) {
    return "--";
  }
  return `frame ${value}`;
}

function formatPixels(value) {
  if (value === null || value === undefined) {
    return "--";
  }
  return Number(value).toLocaleString();
}

function formatRatio(value) {
  if (value === null || value === undefined) {
    return "--";
  }
  return Number(value).toFixed(4);
}
