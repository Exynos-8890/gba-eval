import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";

const root = new URL("./", import.meta.url);
const text = (name) => readFileSync(new URL(name, root), "utf8");

assert.equal(existsSync(new URL("recorder.html", root)), true, "recorder.html should exist");
assert.equal(existsSync(new URL("recorder.js", root)), true, "recorder.js should exist");
assert.equal(existsSync(new URL("recorder-core.js", root)), true, "recorder-core.js should exist");
assert.equal(existsSync(new URL("candidate-manifest.json", root)), true, "candidate manifest should exist");

const html = text("recorder.html");
assert.match(html, /type="module" src="\.\/recorder\.js"/);
assert.match(html, /id="reference-canvas"/);
assert.match(html, /id="candidate-canvas"/);
assert.match(html, /id="diff-canvas"/);

const manifest = JSON.parse(text("candidate-manifest.json"));
assert.ok(manifest.candidates.length >= 8, "should list downloaded top candidates");
assert.equal(manifest.candidates[0].id, "claude-fable-5");
for (const candidate of manifest.candidates) {
  const wasm = new URL(`results/${candidate.id}/candidate.wasm`, root);
  assert.equal(existsSync(wasm), true, `${candidate.id} wasm should exist`);
  assert.equal(statSync(wasm).size, candidate.bytes, `${candidate.id} byte size should match manifest`);
}

const core = await import(new URL("recorder-core.js", root));
assert.equal(core.WIDTH, 240);
assert.equal(core.HEIGHT, 160);
assert.equal(core.FRAME_BYTES, 240 * 160 * 4);
assert.equal(core.frameName("reference", 7), "reference/frame_0007.png");

const ref = new Uint8Array([0, 0, 0, 255, 255, 255, 255, 255]);
const cand = new Uint8Array([0, 0, 0, 255, 240, 255, 255, 255]);
const diff = new Uint8ClampedArray(8);
const changed = core.writeDiffImage(ref, cand, diff, 2);
assert.equal(changed, 1);
assert.deepEqual([...diff.slice(0, 4)], [0, 0, 0, 255]);
assert.notDeepEqual([...diff.slice(4, 8)], [0, 0, 0, 255]);

const zip = core.createZip([
  { name: "reference/frame_0000.txt", bytes: new TextEncoder().encode("ref") },
  { name: "candidate/frame_0000.txt", bytes: new TextEncoder().encode("cand") },
]);
assert.equal(zip[0], 0x50);
assert.equal(zip[1], 0x4b);
assert.ok(zip.length > 100);

console.log("recorder smoke test passed");
