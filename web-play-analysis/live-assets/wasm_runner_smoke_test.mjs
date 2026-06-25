import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import createMesen from "./wasm/mesen_step-DY7riCoT.js";
import { FRAME_BYTES, writeDiffImage } from "./recorder-core.js";

const rom = new Uint8Array(readFileSync(new URL("./roms/homebrew/celeste-classic.gba", import.meta.url)));

const mesen = await createMesen({
  wasmBinary: readFileSync(new URL("./wasm/mesen_step.wasm", import.meta.url)),
});
assert.equal(typeof mesen._mesen_init, "function");
assert.equal(mesen._mesen_init(), 1);
mesen.HEAPU8.set(rom, mesen._mesen_rom_buffer());
assert.equal(mesen._mesen_load_rom(rom.length), 1);
for (let frame = 0; frame < 12; frame += 1) mesen._mesen_run_frame();
const refPtr = mesen._mesen_framebuffer();
const reference = mesen.HEAPU8.subarray(refPtr, refPtr + FRAME_BYTES);
assert.equal(reference.length, FRAME_BYTES);

const candidateWasm = readFileSync(new URL("./results/gpt-5-5/candidate.wasm", import.meta.url));
const { instance } = await WebAssembly.instantiate(candidateWasm, {});
const candidateExports = instance.exports;
assert.equal(candidateExports.emu_init(), 1);
new Uint8Array(candidateExports.memory.buffer).set(rom, candidateExports.emu_rom_buffer());
assert.equal(candidateExports.emu_load_rom(rom.length), 1);
for (let frame = 0; frame < 12; frame += 1) candidateExports.emu_run_frame();
const candidate = new Uint8Array(
  candidateExports.memory.buffer,
  candidateExports.emu_framebuffer(),
  FRAME_BYTES,
);
assert.equal(candidate.length, FRAME_BYTES);

const diff = new Uint8ClampedArray(FRAME_BYTES);
const changed = writeDiffImage(reference, candidate, diff);
assert.ok(changed >= 0);

console.log(JSON.stringify({ refBytes: reference.length, candBytes: candidate.length, changed }));
