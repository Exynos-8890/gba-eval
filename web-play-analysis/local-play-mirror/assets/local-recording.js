import { createZip, frameName } from "./local-recording-core.js";

const FRAME_MS = 1000 / 59.7275;
const state = {
  recording: false,
  lastZip: null,
  lastName: "gbaeval-reference-candidate.zip",
};

mountRecorder();

function mountRecorder() {
  if (document.querySelector("#local-recording-panel")) return;
  const panel = document.createElement("section");
  panel.id = "local-recording-panel";
  panel.innerHTML = `
    <style>
      #local-recording-panel {
        position: fixed;
        right: 16px;
        bottom: 16px;
        z-index: 10000;
        width: 300px;
        color: #ece8f4;
        background: #11101a;
        border: 1px solid #423b58;
        border-radius: 8px;
        box-shadow: 0 16px 40px rgba(0, 0, 0, .55), inset 0 1px rgba(255,255,255,.08);
        padding: 12px;
        font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      }
      #local-recording-panel .lr-title {
        margin: 0 0 10px;
        font-size: 12px;
        font-weight: 700;
        letter-spacing: 0;
      }
      #local-recording-panel .lr-row {
        display: grid;
        grid-template-columns: 1fr auto;
        gap: 8px;
        align-items: center;
        margin-top: 8px;
      }
      #local-recording-panel label {
        display: grid;
        gap: 5px;
        color: #aaa2bb;
        font-size: 11px;
      }
      #local-recording-panel input,
      #local-recording-panel button {
        min-height: 32px;
        border: 1px solid #3b354f;
        border-radius: 6px;
        background: #1b1826;
        color: #ece8f4;
        font: inherit;
        font-size: 12px;
      }
      #local-recording-panel input {
        width: 100%;
        padding: 0 8px;
      }
      #local-recording-panel button {
        cursor: pointer;
        padding: 0 10px;
      }
      #local-recording-panel button:hover:not(:disabled) {
        border-color: #8ea7ff;
      }
      #local-recording-panel button:disabled {
        cursor: not-allowed;
        opacity: .45;
      }
      #local-recording-panel .lr-primary {
        background: #31406e;
        border-color: #617bd0;
      }
      #local-recording-panel .lr-status {
        margin-top: 10px;
        min-height: 34px;
        color: #aaa2bb;
        font-size: 11px;
        line-height: 1.45;
      }
    </style>
    <h2 class="lr-title">Local capture</h2>
    <div class="lr-row">
      <label>Frames <input id="lr-frame-count" type="number" min="1" max="1800" value="180"></label>
      <button id="lr-record" class="lr-primary">Record ref/cand</button>
    </div>
    <div class="lr-row">
      <button id="lr-scan">Scan canvases</button>
      <button id="lr-download" disabled>Download last</button>
    </div>
    <div id="lr-status" class="lr-status">Load a game first, then record reference and candidate frames.</div>
  `;
  document.body.appendChild(panel);

  panel.querySelector("#lr-record").addEventListener("click", () => {
    recordReferenceAndCandidate(panel).catch((error) => setStatus(panel, error.message || String(error)));
  });
  panel.querySelector("#lr-scan").addEventListener("click", () => {
    const pair = queryPlayableCanvases();
    setStatus(panel, pair ? `Found canvases: reference ${pair.reference.width}x${pair.reference.height}, candidate ${pair.candidate.width}x${pair.candidate.height}.` : "Could not find reference/candidate canvases yet.");
  });
  panel.querySelector("#lr-download").addEventListener("click", () => downloadLast());
}

export function queryPlayableCanvases() {
  const panels = [...document.querySelectorAll(".panel-bezel")].map((panel) => ({
    panel,
    canvas: panel.querySelector("canvas"),
    label: (panel.querySelector(".nameplate")?.textContent || "").trim().toLowerCase(),
  }));
  const playable = panels.filter((entry) => entry.canvas && !entry.label.includes("diff"));
  if (playable.length < 2) return null;
  return {
    reference: playable[0].canvas,
    candidate: playable[playable.length - 1].canvas,
    referenceLabel: playable[0].label,
    candidateLabel: playable[playable.length - 1].label,
  };
}

async function recordReferenceAndCandidate(panel) {
  const pair = queryPlayableCanvases();
  if (!pair) throw new Error("Reference/candidate canvases are not visible yet. Press Load or wait for the game to render.");

  const frames = clamp(Number.parseInt(panel.querySelector("#lr-frame-count").value, 10) || 1, 1, 1800);
  const recordButton = panel.querySelector("#lr-record");
  const downloadButton = panel.querySelector("#lr-download");
  recordButton.disabled = true;
  downloadButton.disabled = true;
  state.recording = true;
  state.lastZip = null;

  try {
    const entries = [
      {
        name: "recording.json",
        bytes: new TextEncoder().encode(
          JSON.stringify(
            {
              source: "local-play-mirror",
              frames,
              captured_at: new Date().toISOString(),
              reference_label: pair.referenceLabel,
              candidate_label: pair.candidateLabel,
              width: pair.reference.width,
              height: pair.reference.height,
              folders: ["reference", "candidate"],
            },
            null,
            2,
          ),
        ),
      },
    ];

    for (let index = 0; index < frames; index += 1) {
      entries.push({ name: frameName("reference", index), bytes: await canvasPng(pair.reference) });
      entries.push({ name: frameName("candidate", index), bytes: await canvasPng(pair.candidate) });
      setStatus(panel, `Recording ${index + 1}/${frames} frames...`);
      await wait(FRAME_MS);
    }

    state.lastZip = createZip(entries);
    state.lastName = `gbaeval-local-ref-cand-${Date.now()}.zip`;
    downloadButton.disabled = false;
    setStatus(panel, `Recorded ${frames} reference/candidate frames. ZIP excludes diff frames.`);
    downloadLast();
  } finally {
    state.recording = false;
    recordButton.disabled = false;
  }
}

function canvasPng(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(async (blob) => {
      if (!blob) {
        reject(new Error("Canvas export failed."));
        return;
      }
      resolve(new Uint8Array(await blob.arrayBuffer()));
    }, "image/png");
  });
}

function downloadLast() {
  if (!state.lastZip) return;
  const blob = new Blob([state.lastZip], { type: "application/zip" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = state.lastName;
  link.click();
  URL.revokeObjectURL(link.href);
}

function setStatus(panel, message) {
  panel.querySelector("#lr-status").textContent = message;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
