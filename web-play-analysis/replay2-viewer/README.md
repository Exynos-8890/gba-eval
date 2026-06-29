# Replay 2 Viewer

Standalone viewer for Replay 2, the Celeste Classic Opus 4.8 idle replay capture.

It intentionally does not modify or depend on the verified `flexible-comparator-ui` demo. It reads the generated frame bundle from:

`../replay-frame-capture/generated/replay2`

The viewer calls `/api/compare`, which runs the existing `synthetic_compare` backend against the saved `reference/` and `candidate/` frame folders. The UI then draws the detected offset regions on the Diff panel, scans offsets from `-5..+5` in the browser, and lets a selected box compare the reference frame to the offset-aligned candidate frame.

Run:

```sh
node web-play-analysis/replay2-viewer/server.mjs
```

Open:

`http://127.0.0.1:8785/`
