import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const root = new URL("./", import.meta.url);

assert.equal(existsSync(new URL("assets/local-recording.js", root)), true, "recording script should exist");
assert.equal(existsSync(new URL("assets/local-recording-core.js", root)), true, "recording core should exist");

const html = readFileSync(new URL("index.html", root), "utf8");
assert.match(html, /assets\/local-recording\.js/, "index.html should load recording script");

const recording = readFileSync(new URL("assets/local-recording.js", root), "utf8");
assert.match(recording, /Record ref\/cand/i);
assert.match(recording, /queryPlayableCanvases/);
assert.doesNotMatch(recording, /play-diff\/frame_/);

const core = await import(new URL("assets/local-recording-core.js", root));
assert.equal(core.frameName("reference", 3), "reference/frame_0003.png");
assert.equal(core.frameName("candidate", 42), "candidate/frame_0042.png");

const zip = core.createZip([
  { name: "reference/frame_0000.txt", bytes: new TextEncoder().encode("ref") },
  { name: "candidate/frame_0000.txt", bytes: new TextEncoder().encode("cand") },
]);
assert.equal(zip[0], 0x50);
assert.equal(zip[1], 0x4b);
assert.ok(zip.length > 100);

console.log("local play recording smoke test passed");
