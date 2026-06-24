# Synthetic Frame Comparison

`synthetic_compare` compares two directories of 240x160 PNG frames with
the same video metric used by the lockstep grader. It is meant for small
controlled experiments where the inputs are images rather than emulator
outputs.

```bash
cargo run -p lockstep --bin synthetic_compare -- \
  --reference /path/to/reference_frames \
  --candidate /path/to/candidate_frames \
  --temporal-window 3 \
  --summary-only \
  --temporal-heatmap-out results/temporal-offset-heatmap.png \
  --temporal-region-overlay-out results/temporal-region-overlay.png
```

The normal lockstep fields still describe strict frame-by-frame scoring:

- `video_score`: the GBA Eval-style score at offset 0.
- `histogram`: per-frame structural defects at offset 0.
- `frame_diff_threshold`: the adaptive replay threshold.

Use `--summary-only` when you want a compact JSON result for experiments,
logs, or a UI. It keeps the normal scores and top-level `temporal_summary`,
but omits the full per-frame histogram, per-tile table, and complete region
list.

Without `--summary-only`, `--temporal-window N` adds the full
`temporal_analysis` object:

- `summary.global_best_offset`: the shortest answer for "how many frames
  is the candidate shifted by?".
- `summary.global_improvement`: how much the whole-frame defect improves
  after applying the best offset.
- `summary.region_count`: how many local time-offset regions were found.
- `summary.top_regions`: the largest local time-offset regions, useful
  when a static menu is correct but moving particles, sprites, or other
  visual elements are delayed.
- `global.best_offset`: the frame offset in `[-N, N]` with the lowest
  whole-frame defect.
- `global.offset_defects`: whole-frame defect at each tested offset.
- `tiles`: per-10x10 tile offset estimates. Static tiles use
  `best_offset: null`.
- `regions`: connected groups of neighboring non-static tiles with the
  same offset. These are easier to read than individual tiles when a
  whole visual layer, sprite group, or particle field is delayed.

The heatmap uses gray for static/no clear offset, green for dynamic
regions whose best offset is 0, blue for positive offsets, and red for
negative offsets.

The region overlay keeps the first reference frame as the background and
draws rectangles around the merged temporal regions. Use it when the
heatmap is too abstract and you want to see the time-offset regions in
the original scene.
