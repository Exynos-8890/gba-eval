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
  --temporal-heatmap-out results/temporal-offset-heatmap.png
```

The normal lockstep fields still describe strict frame-by-frame scoring:

- `video_score`: the GBA Eval-style score at offset 0.
- `histogram`: per-frame structural defects at offset 0.
- `frame_diff_threshold`: the adaptive replay threshold.

When `--temporal-window N` is provided, the output also includes
`temporal_analysis`:

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
