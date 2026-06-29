# Mixed Timing Demo Evolution

This document records the main research-driven versions of the mixed timing
demo. These were not bug-fix checkpoints. Each step increased the difficulty of
the comparison problem or made the evaluation more explainable.

The current demo folder is:

```text
results/mixed-timing-demo-verify/
```

The main files are:

- `reference/`: generated reference PNG frames.
- `candidate/`: generated candidate PNG frames.
- `mixed-timing-demo.html`: static browser demo.
- `temporal-heatmap.png`: sequence-level temporal offset heatmap.
- `temporal-region-overlay.png`: detected temporal regions over the first
  reference frame.
- `demo_smoke_test.mjs`: lightweight structure check for the HTML demo.

The core comparison logic lives in Rust under `harness/lockstep`, not in the
HTML. The HTML is a static explanation surface for one generated experiment.

## Current Pipeline

The experiment currently works like this:

```text
Rust synthetic demo generator
  -> reference/candidate PNG frames
  -> Rust synthetic_compare temporal analysis
  -> temporal_summary / local_offsets / region overlay
  -> static HTML demo that explains one result
```

The static HTML can be opened directly with `file://`; it does not require a
local server.

## Version 1: Lockstep Difference Only

Initial goal:

Show whether two generated frame sequences differ when compared at the same
frame index.

What it showed:

- `reference(t)` and `candidate(t)` can be compared frame-by-frame.
- The middle panel can show a current-frame diff image.
- This is easy to understand, but it cannot explain temporal delay.

Limitation:

If an object is simply delayed, lockstep diff says "different" without saying
"this looks like the same object from a nearby frame."

Why we moved on:

We wanted to distinguish visual mismatch from temporal mismatch.

## Version 2: Offset-Corrected Difference

New goal:

Show that a suspected temporal offset can reduce the diff.

Change:

The demo added two stacked diff views:

- `Lockstep t+0`: compare `reference(t)` with `candidate(t)`.
- `Offset-corrected diff`: compare selected regions of `reference(t)` with
  `candidate(t + offset)`.

What it showed:

If the offset is correct, the corrected diff becomes visibly cleaner in that
region.

Why this mattered:

It made `t+2`, `t-1`, and later `t+5`, `t-4` visually meaningful. The offset
was no longer just a label; it changed the comparison image.

Limitation:

At this stage, the regions and offsets still felt too pre-decided in the demo.

## Version 3: Wider Search Window

New goal:

Stop assuming the offset is small. Search a wider temporal range.

Change:

The analysis was run with:

```text
--temporal-window 5
```

This means the algorithm checks offsets from `-5` through `+5`.

Synthetic scene:

- Top-right moving particles are delayed by `+5`.
- Bottom-right moving particles are advanced by `-4`.

What the current Rust analysis does:

- Split the frame into 10x10 tiles.
- For each tile, evaluate all offsets in `[-5, +5]`.
- Choose the offset with the lowest defect.
- Ignore mostly static tiles.
- Merge neighboring tiles with the same offset into regions.

Result:

The algorithm detected:

- `top_right`: `+5`
- `bottom_right`: `-4`
- classification: `mixed_local_time_shifts`

Why we moved on:

The result was correct, but the page still needed to show how the answer was
found, not just display the final answer.

## Version 4: Algorithm-Detected Regions

New goal:

The boxes should come from the comparison result, not from hand-written
frontend coordinates.

Change:

The demo stopped using a hard-coded JavaScript array like:

```text
const offsetRegions = [...]
```

Instead, the page reads embedded `detectedRegionData`, shaped like the
`temporal_summary.local_offsets` output from the Rust comparison.

What this achieved:

- The boxes are derived from the temporal analysis result.
- The HTML no longer hand-authors the box positions.
- The same region data drives both the drawn boxes and the offset-corrected
  diff.

Important caveat:

The current HTML still embeds a static snapshot of the comparison result. It
does not run the Rust comparison in the browser. The intended pipeline is to
generate or update this JSON from the Rust output.

Why we moved on:

Even if the data came from the algorithm, showing boxes immediately on page
load still looked like the answer was pre-supplied.

## Version 5: Search Process Visualization

New goal:

Make the page show the process of finding the offset.

Change:

The page added an `Offset Search Evidence` section and a `Run search` button.

Initial page state:

- No boxes are drawn.
- Summary says `not searched`.
- No `+5` or `-4` conclusion is visible.

After clicking `Run search`:

- The page scans offsets from `-5` through `+5` for each detected region.
- It draws one bar per offset.
- Shorter bar means lower error.
- The highlighted shortest bar is the selected offset.
- Only after this does the page reveal boxes and update the summary.

What this achieved:

The demo now communicates that the offset is found by searching a range, not by
being known in advance.

Remaining limitation:

The page currently visualizes the search over already-detected regions. A fully
faithful process view would also animate tile-level voting and region merging.

## Version 6: Synchronized Moving Background

New goal:

Make the scene harder by adding a background that also moves, but moves
correctly in both reference and candidate.

Change:

The old static full-screen grid background was replaced with sparse diagonal
lines that drift slowly over time.

Scene structure:

- Background diagonal lines: moving, but synchronized between reference and
  candidate at the same frame index.
- Top-right particles: delayed by `+5`.
- Bottom-right particles: advanced by `-4`.

Why this is harder:

The algorithm no longer compares moving objects against a static background.
Each tile may contain a mixture of:

- synchronized background motion, which prefers offset `0`;
- delayed foreground particles, which prefer `+5`;
- advanced foreground particles, which prefer `-4`.

Observed result:

The current algorithm still detected the two important regions:

- `top_right`: `+5`
- `bottom_right`: `-4`

But it also produced extra fragmentation and a small spurious region:

- a small `middle_right +1` region appeared;
- top-right became split into several smaller detected regions.

Interpretation:

This is a useful stress test. The method still works, but synchronized moving
background starts to interfere with tile-level voting and region grouping.

## Current Findings

The demo now shows a meaningful progression:

1. Lockstep diff can detect difference, but not explain time.
2. Offset-corrected diff can show why a temporal offset helps.
3. A `[-5, +5]` search window can recover larger local delays.
4. Regions can be produced from tile-level temporal analysis.
5. The UI can reveal the search process rather than showing the answer first.
6. Moving synchronized backgrounds expose the next research problem:
   separating foreground temporal errors from correctly moving background.

## Current Known Weaknesses

The current algorithm is tile-based. That is simple and interpretable, but it
has a mixed-layer problem.

If one 10x10 tile contains both synchronized background and delayed foreground,
the tile gets only one winning offset. The majority content can dominate the
vote.

This explains why the moving-background experiment produced extra small
regions and more fragmented boxes.

## Suggested Next Research Step

The next algorithmic step should focus on residual-aware detection.

A practical next version:

1. First compare `reference(t)` and `candidate(t)` at lockstep.
2. Treat synchronized moving background as mostly canceled out.
3. Build a residual mask from pixels or small patches that still differ.
4. Search offsets only on those residual areas.
5. Merge residual regions by best offset.

This would move the experiment from:

```text
Which offset best explains this whole tile?
```

to:

```text
Which offset best explains the pixels that remain wrong after lockstep?
```

That should be better for scenes with a correctly moving background and a
temporally wrong foreground object.

## Useful Reproduction Commands

Generate the current mixed timing frame sequence:

```bash
cargo run -p lockstep --bin synthetic_mixed_timing_demo -- \
  --out results/mixed-timing-demo-verify \
  --frames 24 \
  --candidate-frames 30 \
  --top-delay 5 \
  --bottom-delay -4
```

Run the current comparison:

```bash
cargo run -p lockstep --bin synthetic_compare -- \
  --reference results/mixed-timing-demo-verify/reference \
  --candidate results/mixed-timing-demo-verify/candidate \
  --temporal-window 5 \
  --summary-only \
  --temporal-heatmap-out results/mixed-timing-demo-verify/temporal-heatmap.png \
  --temporal-region-overlay-out results/mixed-timing-demo-verify/temporal-region-overlay.png
```

Run the focused Rust tests:

```bash
cargo test -p lockstep --test synthetic_compare
```

Check the static HTML demo:

```bash
node results/mixed-timing-demo-verify/demo_smoke_test.mjs
```
