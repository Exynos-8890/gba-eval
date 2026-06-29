import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import createMesenModule from "../live-assets/wasm/mesen_step-DY7riCoT.js";
import {
  FRAME_BYTES,
  HEIGHT,
  WIDTH,
  encodePngRgba,
  frameName,
  keysAt,
  parseReplayText,
  selectFrameRange,
  writeDiffImage,
} from "./capture-utils.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "../..");

const defaults = {
  replay: "web-play-analysis/replay-frame-capture/replays/replay1.replay",
  rom: "corpus/roms/homebrew/celeste-classic.gba",
  candidateId: "claude-opus-4-8",
  frames: 60,
  out: "web-play-analysis/replay-frame-capture/generated/replay1",
};

const args = parseArgs(process.argv.slice(2));
const replayPath = resolve(repoRoot, args.replay ?? defaults.replay);
const romPath = resolve(repoRoot, args.rom ?? defaults.rom);
const candidateId = args.candidate ?? defaults.candidateId;
const frameLimit = Number.parseInt(args.last ?? args.frames ?? String(defaults.frames), 10);
const outDir = resolve(repoRoot, args.out ?? defaults.out);
const candidatePath = resolve(repoRoot, `web-play-analysis/live-assets/results/${candidateId}/candidate.wasm`);
const mesenWasmPath = resolve(repoRoot, "web-play-analysis/live-assets/wasm/mesen_step.wasm");

if (!Number.isFinite(frameLimit) || frameLimit <= 0) {
  throw new Error("--frames must be a positive integer");
}

const replay = parseReplayText(await readFile(replayPath, "utf8"));
const frameRange = selectFrameRange({
  totalFrames: replay.totalFrames || frameLimit,
  frames: frameLimit,
  last: args.last !== undefined,
});
const rom = new Uint8Array(await readFile(romPath));
const [reference, candidate] = await Promise.all([
  createMesenBackend(),
  createCandidateBackend(candidateId, candidatePath),
]);

reference.loadRom(rom);
candidate.loadRom(rom);
burnBootFrames(reference);
burnBootFrames(candidate);

await rm(outDir, { recursive: true, force: true });
await mkdir(join(outDir, "reference"), { recursive: true });
await mkdir(join(outDir, "candidate"), { recursive: true });
await mkdir(join(outDir, "diff"), { recursive: true });

const diff = new Uint8Array(FRAME_BYTES);
const perFrame = [];

for (let frame = 0; frame < frameRange.endFrame; frame += 1) {
  const keys = keysAt(replay, frame);
  reference.setKeys(keys);
  candidate.setKeys(keys);
  reference.stepFrame();
  candidate.stepFrame();

  if (frame < frameRange.startFrame) {
    continue;
  }

  const refFrame = copyFrame(reference.framebuffer());
  const candFrame = copyFrame(candidate.framebuffer());
  const changedPixels = writeDiffImage(refFrame, candFrame, diff);

  await Promise.all([
    writePng(join(outDir, frameName("reference", frame)), refFrame),
    writePng(join(outDir, frameName("candidate", frame)), candFrame),
    writePng(join(outDir, frameName("diff", frame)), diff),
  ]);

  perFrame.push({
    frame,
    keys,
    changed_pixels: changedPixels,
  });
}

const metadata = {
  source: "replay-frame-capture",
  replay: {
    path: relativePath(replayPath),
    recording: replay.recording,
    date: replay.date,
    total_frames: replay.totalFrames,
    event_count: replay.events.length,
    events: replay.events,
  },
  rom: {
    path: relativePath(romPath),
    bytes: rom.length,
  },
  reference: {
    label: reference.label,
    wasm: relativePath(mesenWasmPath),
    boot_frames: reference.bootFrames,
  },
  candidate: {
    id: candidateId,
    label: candidate.label,
    wasm: relativePath(candidatePath),
    boot_frames: candidate.bootFrames,
  },
  width: WIDTH,
  height: HEIGHT,
  captured_frames: frameRange.captureFrames,
  start_frame: frameRange.startFrame,
  end_frame_exclusive: frameRange.endFrame,
  frame_sets: {
    reference: frameName("reference", frameRange.startFrame),
    candidate: frameName("candidate", frameRange.startFrame),
    diff: frameName("diff", frameRange.startFrame),
  },
  per_frame: perFrame,
};

await writeFile(join(outDir, "recording.json"), `${JSON.stringify(metadata, null, 2)}\n`);

console.log(JSON.stringify({
  out: relativePath(outDir),
  frames: frameRange.captureFrames,
  start_frame: frameRange.startFrame,
  end_frame_exclusive: frameRange.endFrame,
  candidate: candidateId,
  replay_events: replay.events.length,
  first_changed_pixels: perFrame[0]?.changed_pixels ?? 0,
  max_changed_pixels: Math.max(...perFrame.map((frame) => frame.changed_pixels)),
}, null, 2));

function parseArgs(rawArgs) {
  const parsed = {};
  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    if (!arg.startsWith("--")) {
      throw new Error(`unknown positional argument: ${arg}`);
    }
    const key = arg.slice(2);
    const value = rawArgs[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`${arg} needs a value`);
    }
    parsed[key] = value;
    index += 1;
  }
  return parsed;
}

async function createMesenBackend() {
  const module = await createMesenModule({
    wasmBinary: await readFile(mesenWasmPath),
  });
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
    loadRom(data) {
      module.HEAPU8.set(data, abi.romBuffer());
      if (!abi.loadRom(data.length)) throw new Error("Mesen load_rom failed");
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
  };
}

async function createCandidateBackend(candidateId, wasmPath) {
  const wasm = await readFile(wasmPath);
  const { instance } = await WebAssembly.instantiate(wasm, {});
  const exports = instance.exports;
  for (const name of ["emu_init", "emu_rom_buffer", "emu_load_rom", "emu_set_keys", "emu_run_frame", "emu_framebuffer"]) {
    if (typeof exports[name] !== "function") throw new Error(`${candidateId} missing ${name}`);
  }
  if (!(exports.memory instanceof WebAssembly.Memory)) throw new Error(`${candidateId} missing memory`);
  if (!exports.emu_init()) throw new Error(`${candidateId} init failed`);
  return {
    label: candidateId,
    bootFrames: typeof exports.emu_boot_frames === "function" ? exports.emu_boot_frames() >>> 0 : 0,
    loadRom(data) {
      new Uint8Array(exports.memory.buffer).set(data, exports.emu_rom_buffer());
      if (!exports.emu_load_rom(data.length)) throw new Error(`${candidateId} load_rom failed`);
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
  };
}

function burnBootFrames(backend) {
  for (let frame = 0; frame < backend.bootFrames; frame += 1) {
    backend.stepFrame();
  }
}

function copyFrame(frame) {
  const output = new Uint8Array(FRAME_BYTES);
  output.set(frame);
  return output;
}

async function writePng(path, rgba) {
  await writeFile(path, encodePngRgba(rgba, WIDTH, HEIGHT));
}

function relativePath(path) {
  return path.startsWith(repoRoot) ? path.slice(repoRoot.length + 1) : path;
}
