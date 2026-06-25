# GBA Eval Play Page Capture Notes

Source page: https://gbaeval.com/play/

This folder stores a local snapshot of the public `/play` page entry point and
the frontend chunks needed to understand how the browser comparison works.

## Saved Files

- `play.html`: the `/play/` HTML entry point.
- `leaderboard.json`: the public model leaderboard metadata.
- `assets/Play-BiuP0Fh6.js`: the main `/play` route logic.
- `assets/audio-g-eAygG3.js`: the WebAssembly backend wrapper and live diff
  overlay.
- `assets/index-BLq_g1KX.js`: the main site bundle, including the precomputed
  result viewer.
- `assets/results-DPxrvMAb.js`: result JSON/PNG path helpers.
- `assets/scoring-CsSG-A7K.js`: leaderboard score display helpers.
- `live-assets/`: downloaded runtime assets for the default Celeste + GPT-5.5
  experiment.

## Downloaded Runtime Assets

These assets were downloaded from the public site on 2026-06-25:

| Local file | Source URL | Size |
| --- | --- | ---: |
| `live-assets/roms/homebrew/celeste-classic.gba` | `https://gbaeval.com/roms/homebrew/celeste-classic.gba` | 5.2 MB |
| `live-assets/wasm/mesen_step.wasm` | `https://gbaeval.com/wasm/mesen_step.wasm` | 1.1 MB |
| `live-assets/wasm/mesen_step-DY7riCoT.js` | `https://gbaeval.com/assets/mesen_step-DY7riCoT.js` | 36 KB |
| `live-assets/results/gpt-5-5/candidate.wasm` | `https://gbaeval.com/results/gpt-5-5/candidate.wasm` | 170 KB |

Total local size: about 6.5 MB.

SHA-256:

```text
4463620519f9c60a435ef0a6fa2cca123409380881fb0d00c63f2daed0c4f85b  live-assets/roms/homebrew/celeste-classic.gba
9272c44a5dea4bd671089ba09bfbbc2a33342b564ffbc5f2cee971255e6f630f  live-assets/wasm/mesen_step.wasm
399e5f99c90cc80f6983d3fb3456a2c68332dc844eaf5881a2f96fec2d6898ee  live-assets/wasm/mesen_step-DY7riCoT.js
d7f94391a282d6e9213d497d53b853484ae9215cca242a077ad1b8619714f2b0  live-assets/results/gpt-5-5/candidate.wasm
```

The files were recognized locally as:

- Celeste: Game Boy Advance ROM image.
- Mesen: WebAssembly module with the expected `mesen_*` and `emu_*` exports.
- GPT-5.5 candidate: WebAssembly module with the expected `emu_*` exports.

Additional candidate WASM files were also downloaded into
`live-assets/results/<candidate>/candidate.wasm` for the first 14 leaderboard
entries that were reachable from the public site. The local manifest is
`live-assets/candidate-manifest.json`.

## Local Recorder

The local recorder lives at:

- `live-assets/recorder.html`
- `live-assets/recorder.js`
- `live-assets/recorder-core.js`

It runs the downloaded Celeste ROM, Mesen reference, and a selected candidate
WASM locally in the browser. It displays:

- Mesen reference frame.
- Current-frame diff.
- Candidate frame.

The recorder exports a ZIP containing exact `240 x 160` PNG frame sequences:

```text
reference/frame_0000.png
candidate/frame_0000.png
play-diff/frame_0000.png
recording.json
```

Open it through a local HTTP server, not directly through `file://`, because
the browser needs to `fetch()` ROM/WASM files:

```bash
cd web-play-analysis/live-assets
python3 -m http.server 8767 --bind 127.0.0.1
```

Then open:

```text
http://127.0.0.1:8767/recorder.html
```

Verification commands:

```bash
node web-play-analysis/live-assets/recorder_smoke_test.mjs
node web-play-analysis/live-assets/wasm_runner_smoke_test.mjs
```

The second test directly initializes Mesen and GPT-5.5 in Node, loads the
Celeste ROM, runs frames, and verifies both framebuffers are `153600` bytes.

## Local Play Mirror Recording

The local mirror at `local-play-mirror/` now keeps the upstream `/play` page
logic and adds a small floating capture panel through:

- `local-play-mirror/assets/local-recording.js`
- `local-play-mirror/assets/local-recording-core.js`

This capture panel does not record the diff view. It records only:

```text
reference/frame_0000.png
candidate/frame_0000.png
recording.json
```

Run the mirror with:

```bash
cd web-play-analysis/local-play-mirror
node server.mjs
```

Then open:

```text
http://127.0.0.1:8771/play
```

Use the page normally, then press `Record ref/cand` in the floating capture
panel. The script looks for the currently visible non-diff canvases, so it
works whether the upstream diff panel is open or closed.

Verification:

```bash
node web-play-analysis/local-play-mirror/recording_smoke_test.mjs
```

## What The Page Actually Runs

The Freeplay page runs emulators in the browser. It does not play a prerecorded
video for the live reference/candidate panels.

The important resources are public:

- ROMs: `/roms/homebrew/<game>.gba`
- Mesen reference wrapper: `/wasm/mesen_step.wasm`
- Candidate emulator: `/results/<candidate>/candidate.wasm`

For example, the default Celeste setup uses:

- `https://gbaeval.com/roms/homebrew/celeste-classic.gba`
- `https://gbaeval.com/wasm/mesen_step.wasm`
- `https://gbaeval.com/results/gpt-5-5/candidate.wasm`

The page loads the same ROM into both backends, then advances both backends
with the same input state each frame.

## Canvas And Frame Size

The emulator frame is fixed-size pixel output:

- logical size: `240 x 160`
- pixel count: `38,400`
- framebuffer bytes: `153,600` RGBA bytes

The visible browser panels are CSS-scaled versions of these canvases. The page
also adds a decorative scanline overlay using CSS. For measurement, we should
not rely on a full-page screenshot because that includes scaling, borders,
scanlines, and possible subpixel placement.

The reliable extraction point is the canvas pixel data itself.

## How The Play Diff Is Generated

The live diff panel is a simple per-pixel RGB difference heatmap. It is not
SSIM.

For each pixel:

```text
diff = abs((ref_r >> 3) - (cand_r >> 3))
     + abs((ref_g >> 3) - (cand_g >> 3))
     + abs((ref_b >> 3) - (cand_b >> 3))
```

So each 8-bit color channel is first reduced to a 5-bit value. A pixel with
`diff > 0` counts as different. The UI also tracks:

- `lastDiff`: number of different pixels in the current frame.
- `diverging`: number of frames whose current-frame diff is above a small
  noise floor.
- `NOISE_FLOOR`: 8 pixels.

The heatmap color is only a visualization of that per-pixel difference value.
It is separate from the benchmark grader's replay scoring.

## Recommended Capture Plan

Best first experiment: capture canvas pixels from the live page, not a screen
recording.

1. Open `https://gbaeval.com/play/`.
2. Select the target game and model.
3. Enable `View diff`.
4. Use browser automation to read the three internal canvases:
   reference, diff, candidate.
5. Export each canvas at its intrinsic `240 x 160` resolution with
   `toBlob()`, `toDataURL()`, or `getImageData()`.
6. Save frames as:
   - `reference/frame_0000.png`
   - `candidate/frame_0000.png`
   - `play-diff/frame_0000.png`
7. Feed `reference/` and `candidate/` into our temporal detector.

This avoids crop errors and avoids the decorative CSS overlay.

## Alternative Deeper Plan

A cleaner but more involved path is to bypass the website UI and instantiate
the same WASM files ourselves:

1. Download the ROM, Mesen reference WASM, and candidate WASM.
2. Instantiate each backend.
3. Feed identical key states.
4. Call `run_frame` / `emu_run_frame`.
5. Read `framebuffer` / `emu_framebuffer`.
6. Write exact PNG frames.

This is better for reproducible experiments, but the Mesen reference uses an
Emscripten glue module, so it is slightly more work than just reading browser
canvas pixels.

## Current Hypothesis

For the research question about temporal mismatch, the most useful first
dataset is not the webpage's diff canvas. We should capture the raw reference
and raw candidate canvases, then run our detector on those two frame sequences.

The webpage's own diff can be saved too, but mainly as a sanity check against
what a human sees in GBA Eval's UI.
