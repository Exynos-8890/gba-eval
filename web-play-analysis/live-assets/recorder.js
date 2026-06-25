import createMesenModule from "./wasm/mesen_step-DY7riCoT.js";
import {
  FRAME_BYTES,
  HEIGHT,
  WIDTH,
  createZip,
  frameName,
  writeDiffImage,
} from "./recorder-core.js";

const ROM_PATH = "./roms/homebrew/celeste-classic.gba";
const FRAME_MS = 1000 / 59.7275;
const KEY_BITS = {
  KeyL: 1,
  KeyK: 2,
  Backspace: 4,
  Enter: 8,
  KeyD: 16,
  KeyA: 32,
  KeyW: 64,
  KeyS: 128,
  KeyO: 256,
  KeyI: 512,
  ArrowRight: 16,
  ArrowLeft: 32,
  ArrowUp: 64,
  ArrowDown: 128,
};

const ui = {
  candidateSelect: document.querySelector("#candidate-select"),
  frameCount: document.querySelector("#frame-count"),
  loadButton: document.querySelector("#load-button"),
  stepButton: document.querySelector("#step-button"),
  playButton: document.querySelector("#play-button"),
  recordButton: document.querySelector("#record-button"),
  downloadButton: document.querySelector("#download-button"),
  referenceCanvas: document.querySelector("#reference-canvas"),
  candidateCanvas: document.querySelector("#candidate-canvas"),
  diffCanvas: document.querySelector("#diff-canvas"),
  referenceLabel: document.querySelector("#reference-label"),
  candidateLabel: document.querySelector("#candidate-label"),
  diffLabel: document.querySelector("#diff-label"),
  frameLabel: document.querySelector("#frame-label"),
  keysLabel: document.querySelector("#keys-label"),
  lastDiffLabel: document.querySelector("#last-diff-label"),
  recordingLabel: document.querySelector("#recording-label"),
  log: document.querySelector("#log"),
};

const state = {
  manifest: null,
  reference: null,
  candidate: null,
  rom: null,
  frame: 0,
  keys: 0,
  playing: false,
  lastTick: 0,
  frameDebt: 0,
  raf: 0,
  zipBytes: null,
  zipName: "gbaeval-recording.zip",
};

const referenceCtx = ui.referenceCanvas.getContext("2d", { alpha: false });
const candidateCtx = ui.candidateCanvas.getContext("2d", { alpha: false });
const diffCtx = ui.diffCanvas.getContext("2d", { alpha: false });
const referenceImage = referenceCtx.createImageData(WIDTH, HEIGHT);
const candidateImage = candidateCtx.createImageData(WIDTH, HEIGHT);
const diffImage = diffCtx.createImageData(WIDTH, HEIGHT);

init().catch((error) => logError(error));

async function init() {
  state.manifest = await fetchJson("./candidate-manifest.json");
  for (const candidate of state.manifest.candidates) {
    const option = document.createElement("option");
    option.value = candidate.id;
    option.textContent = `#${candidate.rank} ${candidate.label}`;
    ui.candidateSelect.appendChild(option);
  }
  ui.candidateSelect.value = "gpt-5-5";
  wireEvents();
  log(`Ready. Downloaded candidates: ${state.manifest.candidates.length}.`);
}

function wireEvents() {
  ui.loadButton.addEventListener("click", () => loadSelected().catch(logError));
  ui.stepButton.addEventListener("click", () => stepOnce());
  ui.playButton.addEventListener("click", () => togglePlay());
  ui.recordButton.addEventListener("click", () => recordZip().catch(logError));
  ui.downloadButton.addEventListener("click", () => downloadLastZip());

  window.addEventListener("keydown", (event) => {
    const bit = KEY_BITS[event.code];
    if (bit === undefined) return;
    event.preventDefault();
    state.keys |= bit;
    updateStatus();
  });
  window.addEventListener("keyup", (event) => {
    const bit = KEY_BITS[event.code];
    if (bit === undefined) return;
    event.preventDefault();
    state.keys &= ~bit;
    updateStatus();
  });
}

async function loadSelected() {
  stopPlay();
  setBusy(true);
  try {
    const selected = state.manifest.candidates.find((candidate) => candidate.id === ui.candidateSelect.value);
    log(`Loading ROM and WASM for ${selected.label}...`);
    state.rom = await fetchBytes(ROM_PATH);
    state.reference?.dispose?.();
    state.candidate?.dispose?.();
    state.reference = await createMesenBackend();
    state.candidate = await createCandidateBackend(selected);
    resetBackends();
    state.frame = 0;
    state.zipBytes = null;
    ui.downloadButton.disabled = true;
    renderCurrentFrame();
    log(`Loaded ${selected.label}. Use keyboard controls, Step, Play, or Record ZIP.`);
  } finally {
    setBusy(false);
  }
}

function resetBackends() {
  for (const backend of [state.reference, state.candidate]) {
    backend.loadRom(state.rom);
    for (let frame = 0; frame < backend.bootFrames; frame += 1) {
      backend.stepFrame();
    }
  }
}

function stepOnce() {
  if (!state.reference || !state.candidate) return;
  state.reference.setKeys(state.keys);
  state.candidate.setKeys(state.keys);
  state.reference.stepFrame();
  state.candidate.stepFrame();
  state.frame += 1;
  renderCurrentFrame();
}

function togglePlay() {
  state.playing ? stopPlay() : startPlay();
}

function startPlay() {
  if (!state.reference || !state.candidate) return;
  state.playing = true;
  state.lastTick = performance.now();
  state.frameDebt = 0;
  ui.playButton.textContent = "Pause";
  state.raf = requestAnimationFrame(playLoop);
}

function stopPlay() {
  state.playing = false;
  cancelAnimationFrame(state.raf);
  state.raf = 0;
  ui.playButton.textContent = "Play";
}

function playLoop(now) {
  if (!state.playing) return;
  state.frameDebt += now - state.lastTick;
  state.lastTick = now;
  if (state.frameDebt > FRAME_MS * 3) state.frameDebt = FRAME_MS * 3;
  while (state.frameDebt >= FRAME_MS) {
    state.frameDebt -= FRAME_MS;
    stepOnce();
  }
  state.raf = requestAnimationFrame(playLoop);
}

async function recordZip() {
  if (!state.reference || !state.candidate) return;
  stopPlay();
  setBusy(true);
  ui.recordingLabel.textContent = "recording";
  const count = Math.max(1, Math.min(1800, Number.parseInt(ui.frameCount.value, 10) || 1));
  const selected = state.manifest.candidates.find((candidate) => candidate.id === ui.candidateSelect.value);
  const startFrame = state.frame;
  const entries = [
    {
      name: "recording.json",
      bytes: new TextEncoder().encode(
        JSON.stringify(
          {
            rom: "celeste-classic.gba",
            candidate: selected,
            start_frame: startFrame,
            frames: count,
            width: WIDTH,
            height: HEIGHT,
          },
          null,
          2,
        ),
      ),
    },
  ];

  try {
    for (let index = 0; index < count; index += 1) {
      stepOnce();
      entries.push({ name: frameName("reference", index), bytes: await canvasPng(ui.referenceCanvas) });
      entries.push({ name: frameName("candidate", index), bytes: await canvasPng(ui.candidateCanvas) });
      entries.push({ name: frameName("play-diff", index), bytes: await canvasPng(ui.diffCanvas) });
      if (index % 10 === 0 || index === count - 1) {
        ui.recordingLabel.textContent = `${index + 1}/${count}`;
        await nextPaint();
      }
    }
    state.zipBytes = createZip(entries);
    state.zipName = `gbaeval-${selected.id}-celeste-f${startFrame}-${count}.zip`;
    ui.downloadButton.disabled = false;
    ui.recordingLabel.textContent = "ready";
    log(`Recorded ${count} frames into ${state.zipName}.`);
  } finally {
    setBusy(false);
  }
}

function renderCurrentFrame() {
  const ref = state.reference.framebuffer();
  const cand = state.candidate.framebuffer();
  referenceImage.data.set(ref);
  candidateImage.data.set(cand);
  const changed = writeDiffImage(ref, cand, diffImage.data);
  referenceCtx.putImageData(referenceImage, 0, 0);
  candidateCtx.putImageData(candidateImage, 0, 0);
  diffCtx.putImageData(diffImage, 0, 0);
  ui.diffLabel.textContent = `${changed} px`;
  ui.lastDiffLabel.textContent = String(changed);
  updateStatus();
}

function updateStatus() {
  ui.frameLabel.textContent = String(state.frame);
  ui.keysLabel.textContent = state.keys.toString(16).padStart(4, "0");
}

async function createMesenBackend() {
  const module = await createMesenModule({ locateFile: (name) => `./wasm/${name}` });
  const abi = {
    init: module._mesen_init,
    romBuffer: module._mesen_rom_buffer,
    loadRom: module._mesen_load_rom,
    reset: module._mesen_reset,
    setKeys: module._mesen_set_keys,
    runFrame: module._mesen_run_frame,
    framebuffer: module._mesen_framebuffer,
  };
  for (const [name, value] of Object.entries(abi)) {
    if (typeof value !== "function") throw new Error(`Mesen missing ${name}`);
  }
  if (!abi.init()) throw new Error("Mesen init failed");
  return {
    label: "Mesen",
    bootFrames: 6,
    loadRom(rom) {
      module.HEAPU8.set(rom, abi.romBuffer());
      if (!abi.loadRom(rom.length)) throw new Error("Mesen load_rom failed");
    },
    reset() {
      abi.reset();
    },
    setKeys(keys) {
      abi.setKeys(keys >>> 0);
    },
    stepFrame() {
      abi.runFrame();
    },
    framebuffer() {
      const ptr = abi.framebuffer();
      return module.HEAPU8.subarray(ptr, ptr + FRAME_BYTES);
    },
    dispose() {},
  };
}

async function createCandidateBackend(candidate) {
  const wasm = await fetchBytes(`./results/${candidate.id}/candidate.wasm`);
  const { instance } = await WebAssembly.instantiate(wasm, {});
  const exports = instance.exports;
  for (const name of ["emu_init", "emu_rom_buffer", "emu_load_rom", "emu_reset", "emu_set_keys", "emu_run_frame", "emu_framebuffer"]) {
    if (typeof exports[name] !== "function") throw new Error(`${candidate.id} missing ${name}`);
  }
  if (!(exports.memory instanceof WebAssembly.Memory)) throw new Error(`${candidate.id} missing memory`);
  if (!exports.emu_init()) throw new Error(`${candidate.id} init failed`);
  return {
    label: candidate.label,
    bootFrames: typeof exports.emu_boot_frames === "function" ? exports.emu_boot_frames() >>> 0 : 0,
    loadRom(rom) {
      new Uint8Array(exports.memory.buffer).set(rom, exports.emu_rom_buffer());
      if (!exports.emu_load_rom(rom.length)) throw new Error(`${candidate.id} load_rom failed`);
    },
    reset() {
      exports.emu_reset();
    },
    setKeys(keys) {
      exports.emu_set_keys(keys >>> 0);
    },
    stepFrame() {
      exports.emu_run_frame();
    },
    framebuffer() {
      return new Uint8Array(exports.memory.buffer, exports.emu_framebuffer(), FRAME_BYTES);
    },
    dispose() {},
  };
}

async function fetchJson(path) {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`${path}: ${response.status}`);
  return response.json();
}

async function fetchBytes(path) {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`${path}: ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}

function canvasPng(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(async (blob) => {
      if (!blob) {
        reject(new Error("canvas PNG export failed"));
        return;
      }
      resolve(new Uint8Array(await blob.arrayBuffer()));
    }, "image/png");
  });
}

function downloadLastZip() {
  if (!state.zipBytes) return;
  const blob = new Blob([state.zipBytes], { type: "application/zip" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = state.zipName;
  link.click();
  URL.revokeObjectURL(link.href);
}

function setBusy(busy) {
  ui.loadButton.disabled = busy;
  ui.candidateSelect.disabled = busy;
  ui.stepButton.disabled = busy || !state.reference;
  ui.playButton.disabled = busy || !state.reference;
  ui.recordButton.disabled = busy || !state.reference;
}

function log(message) {
  ui.log.textContent = message;
}

function logError(error) {
  console.error(error);
  log(error instanceof Error ? error.message : String(error));
  setBusy(false);
}

function nextPaint() {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}
