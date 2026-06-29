const frameCount = 24;
const candidateFrameCount = 30;
const temporalWindow = 5;
const frameBaseUrl = "/demos/mixed";

const detectedRegionData = {
  classification: "mixed_local_time_shifts",
  local_offsets: [
    {
      offset: -4,
      location_label: "bottom_right",
      x: 120,
      y: 90,
      width: 110,
      height: 60,
    },
    {
      offset: 5,
      location_label: "top_right",
      x: 120,
      y: 0,
      width: 110,
      height: 70,
    },
    {
      offset: 1,
      location_label: "middle_right",
      x: 180,
      y: 40,
      width: 50,
      height: 30,
    },
  ],
};

const frameSlider = document.querySelector("#frameSlider");
const playPause = document.querySelector("#playPause");
const refFrame = document.querySelector("#refFrame");
const candFrame = document.querySelector("#candFrame");
const currentDiffCanvas = document.querySelector("#currentDiffCanvas");
const currentDiffContext = currentDiffCanvas.getContext("2d", { willReadFrequently: true });
const alignedDiffCanvas = document.querySelector("#alignedDiffCanvas");
const alignedDiffContext = alignedDiffCanvas.getContext("2d", { willReadFrequently: true });
const refIndex = document.querySelector("#refIndex");
const candIndex = document.querySelector("#candIndex");
const frameReadout = document.querySelector("#frameReadout");
const runSearchButton = document.querySelector("#runSearchButton");
const searchStatus = document.querySelector("#searchStatus");
const offsetSearchPanel = document.querySelector("#offsetSearchPanel");
const topOffsetSummary = document.querySelector("#topOffsetSummary");
const bottomOffsetSummary = document.querySelector("#bottomOffsetSummary");

const refScratch = document.createElement("canvas");
const candScratch = document.createElement("canvas");
const offsetScratch = document.createElement("canvas");
refScratch.width = candScratch.width = offsetScratch.width = 240;
refScratch.height = candScratch.height = offsetScratch.height = 160;
const refScratchContext = refScratch.getContext("2d", { willReadFrequently: true });
const candScratchContext = candScratch.getContext("2d", { willReadFrequently: true });
const offsetScratchContext = offsetScratch.getContext("2d", { willReadFrequently: true });

const detectedRegions = detectedRegionData.local_offsets
  .map((region) => ({
    name: region.location_label,
    offset: region.offset,
    color: offsetColor(region.offset),
    x: region.x,
    y: region.y,
    width: region.width,
    height: region.height,
  }))
  .sort((a, b) => a.y - b.y || a.x - b.x);

const candidateFrameCache = new Map();
const referenceFrameCache = new Map();

let frame = 0;
let playing = false;
let timer = null;
let searchHasRun = false;

render(0);

playPause.addEventListener("click", () => {
  if (playing) {
    stop();
  } else {
    play();
  }
});

frameSlider.addEventListener("input", (event) => {
  render(Number(event.target.value));
});

refFrame.addEventListener("load", () => {
  drawCurrentDiff();
  drawAlignedDiff();
});

candFrame.addEventListener("load", () => {
  drawCurrentDiff();
  drawAlignedDiff();
});

runSearchButton.addEventListener("click", renderOffsetSearch);

function frameName(index) {
  return `frame_${String(index).padStart(4, "0")}.png`;
}

function render(nextFrame) {
  frame = ((nextFrame % frameCount) + frameCount) % frameCount;
  const candidateFrame = frame % candidateFrameCount;
  const refName = frameName(frame);
  const candName = frameName(candidateFrame);

  refFrame.src = `${frameBaseUrl}/reference/${refName}`;
  candFrame.src = `${frameBaseUrl}/candidate/${candName}`;
  refIndex.textContent = refName;
  candIndex.textContent = candName;
  frameSlider.value = String(frame);
  frameReadout.textContent = `${frame} / ${frameCount - 1}`;

  for (const region of detectedRegions) {
    loadCandidateFrame(matchFrame(region.offset));
  }

  drawCurrentDiff();
  drawAlignedDiff();
}

function matchFrame(offset) {
  return ((frame + offset) % candidateFrameCount + candidateFrameCount) % candidateFrameCount;
}

function loadCandidateFrame(index) {
  const name = frameName(index);
  if (candidateFrameCache.has(name)) {
    return candidateFrameCache.get(name);
  }

  const image = new Image();
  image.addEventListener("load", drawAlignedDiff);
  image.src = `${frameBaseUrl}/candidate/${name}`;
  candidateFrameCache.set(name, image);
  return image;
}

function loadReferenceFrame(index) {
  const name = frameName(index);
  if (referenceFrameCache.has(name)) {
    return referenceFrameCache.get(name);
  }

  const image = new Image();
  image.src = `${frameBaseUrl}/reference/${name}`;
  referenceFrameCache.set(name, image);
  return image;
}

function imageReady(image) {
  if (image.complete && image.naturalWidth) {
    return Promise.resolve(image);
  }

  return new Promise((resolve, reject) => {
    image.addEventListener("load", () => resolve(image), { once: true });
    image.addEventListener("error", reject, { once: true });
  });
}

function offsetColor(offset) {
  return offset >= 0 ? "#4d7cff" : "#ff5a4f";
}

function drawCurrentDiff() {
  if (!frameImagesReady()) {
    return;
  }

  const refPixels = readFramePixels(refFrame, refScratchContext);
  const candPixels = readFramePixels(candFrame, candScratchContext);
  drawDiffPixels(currentDiffContext, refPixels, candPixels);
  if (searchHasRun) {
    drawOffsetGuide(currentDiffContext, "t+0");
  }
}

function drawAlignedDiff() {
  if (!frameImagesReady()) {
    return;
  }

  const refPixels = readFramePixels(refFrame, refScratchContext);
  const alignedCandidatePixels = readFramePixels(candFrame, candScratchContext);

  if (searchHasRun) {
    for (const region of detectedRegions) {
      const offsetFrame = loadCandidateFrame(matchFrame(region.offset));
      if (!offsetFrame.complete || !offsetFrame.naturalWidth) {
        return;
      }
      const offsetPixels = readFramePixels(offsetFrame, offsetScratchContext);
      copyRegion(offsetPixels, alignedCandidatePixels, region);
    }
  }

  drawDiffPixels(alignedDiffContext, refPixels, alignedCandidatePixels);
  if (searchHasRun) {
    drawOffsetGuide(alignedDiffContext, "offset");
  }
}

function frameImagesReady() {
  return refFrame.complete && candFrame.complete && refFrame.naturalWidth && candFrame.naturalWidth;
}

function readFramePixels(image, context) {
  context.drawImage(image, 0, 0, 240, 160);
  return context.getImageData(0, 0, 240, 160);
}

function copyRegion(sourcePixels, targetPixels, region) {
  for (let y = region.y; y < region.y + region.height; y += 1) {
    for (let x = region.x; x < region.x + region.width; x += 1) {
      const index = (y * 240 + x) * 4;
      targetPixels.data[index] = sourcePixels.data[index];
      targetPixels.data[index + 1] = sourcePixels.data[index + 1];
      targetPixels.data[index + 2] = sourcePixels.data[index + 2];
      targetPixels.data[index + 3] = sourcePixels.data[index + 3];
    }
  }
}

function drawDiffPixels(context, refPixels, candPixels) {
  const diffPixels = context.createImageData(240, 160);

  for (let index = 0; index < refPixels.data.length; index += 4) {
    const dr = Math.abs(refPixels.data[index] - candPixels.data[index]);
    const dg = Math.abs(refPixels.data[index + 1] - candPixels.data[index + 1]);
    const db = Math.abs(refPixels.data[index + 2] - candPixels.data[index + 2]);
    const changed = dr + dg + db > 24;

    diffPixels.data[index] = changed ? 255 : 34;
    diffPixels.data[index + 1] = changed ? 184 : 38;
    diffPixels.data[index + 2] = changed ? 84 : 48;
    diffPixels.data[index + 3] = 255;
  }

  context.putImageData(diffPixels, 0, 0);
}

function drawOffsetGuide(context, mode) {
  for (const region of detectedRegions) {
    const label = mode === "offset" ? `cand t${region.offset > 0 ? "+" : ""}${region.offset}` : "cand t+0";
    context.save();
    context.strokeStyle = region.color;
    context.lineWidth = 2;
    context.strokeRect(region.x + 0.5, region.y + 0.5, region.width - 1, region.height - 1);
    context.fillStyle = "rgba(11, 13, 18, 0.88)";
    context.fillRect(region.x + 5, region.y + 6, 64, 16);
    context.fillStyle = region.color;
    context.font = "10px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
    context.fillText(label, region.x + 9, region.y + 18);
    context.restore();
  }
}

async function computeOffsetSearch(region) {
  const offsets = [];
  for (let offset = -temporalWindow; offset <= temporalWindow; offset += 1) {
    let changedPixels = 0;
    let totalPixels = 0;
    let comparedFrames = 0;

    for (let refFrameIndex = 0; refFrameIndex < frameCount; refFrameIndex += 1) {
      const candidateIndex = refFrameIndex + offset;
      if (candidateIndex < 0 || candidateIndex >= candidateFrameCount) {
        continue;
      }

      const [referenceImage, candidateImage] = await Promise.all([
        imageReady(loadReferenceFrame(refFrameIndex)),
        imageReady(loadCandidateFrame(candidateIndex)),
      ]);
      const refPixels = readFramePixels(referenceImage, refScratchContext);
      const candPixels = readFramePixels(candidateImage, candScratchContext);

      for (let y = region.y; y < region.y + region.height; y += 1) {
        for (let x = region.x; x < region.x + region.width; x += 1) {
          const index = (y * 240 + x) * 4;
          const dr = Math.abs(refPixels.data[index] - candPixels.data[index]);
          const dg = Math.abs(refPixels.data[index + 1] - candPixels.data[index + 1]);
          const db = Math.abs(refPixels.data[index + 2] - candPixels.data[index + 2]);
          if (dr + dg + db > 24) {
            changedPixels += 1;
          }
          totalPixels += 1;
        }
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

async function renderOffsetSearch() {
  runSearchButton.disabled = true;
  searchStatus.textContent = `Scanning offsets -${temporalWindow}..+${temporalWindow}`;
  offsetSearchPanel.innerHTML = `<div class="search-card">Scanning offsets -${temporalWindow}..+${temporalWindow}</div>`;

  const cards = await Promise.all(detectedRegions.map(renderSearchCard));
  offsetSearchPanel.innerHTML = cards.join("");
  searchHasRun = true;
  updateSummaryAfterSearch();
  drawCurrentDiff();
  drawAlignedDiff();
  searchStatus.textContent = "Search complete; boxes are now revealed";
  runSearchButton.disabled = false;
}

async function renderSearchCard(region) {
  const offsets = await computeOffsetSearch(region);
  const best = offsets.reduce((currentBest, item) => {
    if (item.error < currentBest.error) {
      return item;
    }
    if (item.error === currentBest.error && Math.abs(item.offset) < Math.abs(currentBest.offset)) {
      return item;
    }
    return currentBest;
  }, offsets[0]);
  const worstError = Math.max(...offsets.map((item) => item.error), 0.001);
  const bars = offsets.map((item) => renderBar(item, best, worstError, region)).join("");
  const bestLabel = `${best.offset > 0 ? "+" : ""}${best.offset}`;
  return `
    <div class="search-card">
      <div class="search-card-title">
        <span>${escapeHtml(region.name)}</span>
        <span style="color: ${region.color}">best t${bestLabel}</span>
      </div>
      <div class="search-bars">${bars}</div>
    </div>
  `;
}

function renderBar(item, best, worstError, region) {
  const isBest = item.offset === best.offset;
  const height = 8 + (item.error / worstError) * 98;
  const label = `${item.offset > 0 ? "+" : ""}${item.offset}`;
  return `
    <div class="search-bar ${isBest ? "is-best" : ""}" style="color: ${region.color}" title="offset ${label}, error ${item.error.toFixed(3)}">
      <div class="search-bar-fill" style="height: ${height}px"></div>
      <div class="search-bar-label">${label}</div>
    </div>
  `;
}

function updateSummaryAfterSearch() {
  const topRegion = detectedRegions.find((region) => region.name === "top_right");
  const bottomRegion = detectedRegions.find((region) => region.name === "bottom_right");
  if (topRegion) {
    topOffsetSummary.textContent = formatOffset(topRegion.offset);
  }
  if (bottomRegion) {
    bottomOffsetSummary.textContent = formatOffset(bottomRegion.offset);
  }
}

function formatOffset(offset) {
  const sign = offset > 0 ? "+" : "";
  const unit = Math.abs(offset) === 1 ? "frame" : "frames";
  return `offset ${sign}${offset} ${unit}`;
}

function stop() {
  playing = false;
  playPause.textContent = "Play";
  if (timer !== null) {
    window.clearInterval(timer);
    timer = null;
  }
}

function play() {
  playing = true;
  playPause.textContent = "Pause";
  timer = window.setInterval(() => render(frame + 1), 180);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => {
    const replacements = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return replacements[char];
  });
}
