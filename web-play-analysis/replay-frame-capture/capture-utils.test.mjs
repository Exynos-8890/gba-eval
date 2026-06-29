import test from "node:test";
import assert from "node:assert/strict";

import { encodePngRgba, keysAt, parseReplayText, selectFrameRange, writeDiffImage } from "./capture-utils.mjs";

test("parses website replay metadata and key events", () => {
  const replay = parseReplayText(`# Recording: Celeste Classic
# Date: 2026-06-29T18:04:34.330Z
# Format: <frame> <keys_hex>
0 0000
12 0011
# Total frames: 368
`);

  assert.equal(replay.recording, "Celeste Classic");
  assert.equal(replay.totalFrames, 368);
  assert.equal(replay.events.length, 2);
  assert.deepEqual(replay.events[1], { frame: 12, keys: 0x0011 });
  assert.equal(keysAt(replay, 0), 0x0000);
  assert.equal(keysAt(replay, 11), 0x0000);
  assert.equal(keysAt(replay, 12), 0x0011);
  assert.equal(keysAt(replay, 60), 0x0011);
});

test("encodes rgba bytes as a PNG file", () => {
  const rgba = new Uint8Array([
    255, 0, 0, 255,
    0, 255, 0, 255,
    0, 0, 255, 255,
    255, 255, 255, 255,
  ]);
  const png = encodePngRgba(rgba, 2, 2);

  assert.deepEqual([...png.slice(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.ok(png.length > rgba.length);
});

test("writes a nonzero diff for changed rgba pixels", () => {
  const reference = new Uint8Array([0, 0, 0, 255, 32, 32, 32, 255]);
  const candidate = new Uint8Array([0, 0, 0, 255, 64, 32, 32, 255]);
  const output = new Uint8Array(reference.length);

  const changed = writeDiffImage(reference, candidate, output, 2);

  assert.equal(changed, 1);
  assert.equal(output[3], 255);
  assert.equal(output[7], 255);
  assert.notEqual(output[4] + output[5] + output[6], 0);
});

test("selects the final replay frames when last is requested", () => {
  assert.deepEqual(selectFrameRange({ totalFrames: 702, frames: 100, last: true }), {
    startFrame: 602,
    endFrame: 702,
    captureFrames: 100,
  });
});
