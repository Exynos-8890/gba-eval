use crate::result::CompareResult;
use crate::video;
use crate::{
    diff_frame, is_flat_frame, luma_mae, quant5, ref_in_motion, GBA_H, GBA_PIXELS, GBA_W,
    NOISE_FLOOR,
};

const TEMPORAL_TILE_SIZE: usize = 10;
const STATIC_MOTION_DEFECT: f32 = 0.001;
const REGION_MIN_IMPROVEMENT: f32 = 0.001;

pub fn compare_framebuffers_lockstep(
    reference: &[[u32; GBA_PIXELS]],
    candidate: &[[u32; GBA_PIXELS]],
) -> CompareResult {
    let n_frames = reference.len().min(candidate.len());
    let mut result = CompareResult::new(n_frames as u32);
    let mut prev_ref_fb = [0u32; GBA_PIXELS];
    let mut ref_defects = Vec::with_capacity(n_frames);
    let mut new_run = Vec::with_capacity(n_frames);

    for frame in 0..n_frames {
        let ref_fb = &reference[frame];
        let cand_fb = &candidate[frame];
        let mut defect = video::ssim_floored(ref_fb, cand_fb);

        if is_flat_frame(cand_fb) && !is_flat_frame(ref_fb) {
            defect = 1.0;
        }
        result.histogram.push(defect);
        result.audit_luma_mae_frames.push(luma_mae(ref_fb, cand_fb));

        let raw_diff = diff_frame(ref_fb, cand_fb);
        if raw_diff > NOISE_FLOOR {
            result.diverging_frames += 1;
            result.total_diff_pixels += raw_diff as u64;
            if result.first_diverge_frame.is_none() {
                result.first_diverge_frame = Some(frame as u32);
            }
            if raw_diff > result.max_diff_pixels {
                result.max_diff_pixels = raw_diff;
                result.max_diff_frame = Some(frame as u32);
            }
        }

        let in_motion = frame == 0 || ref_in_motion(&prev_ref_fb, ref_fb);
        new_run.push(in_motion);
        if frame > 0 && in_motion {
            ref_defects.push(video::ssim_floored(&prev_ref_fb, ref_fb));
        }
        prev_ref_fb.copy_from_slice(ref_fb);
    }

    result.frame_diff_threshold = video::defect_threshold_clamped(&mut ref_defects);
    result.replay_score_deduped =
        replay_score_deduped(&result.histogram, &new_run, result.frame_diff_threshold);
    result
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct TemporalAnalysis {
    pub max_offset: i32,
    pub global: TemporalOffsetEstimate,
    pub tile_size: usize,
    pub tile_grid_width: usize,
    pub tile_grid_height: usize,
    pub regions: Vec<TemporalRegion>,
    pub tiles: Vec<TileTemporalOffset>,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct TemporalOffsetEstimate {
    pub best_offset: Option<i32>,
    pub lockstep_defect: f32,
    pub best_defect: f32,
    pub improvement: f32,
    pub offset_defects: Vec<OffsetDefect>,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct OffsetDefect {
    pub offset: i32,
    pub defect: f32,
    pub overlap_frames: usize,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct TileTemporalOffset {
    pub x: usize,
    pub y: usize,
    pub width: usize,
    pub height: usize,
    pub motion_defect: f32,
    pub best_offset: Option<i32>,
    pub lockstep_defect: f32,
    pub best_defect: f32,
    pub improvement: f32,
    pub confidence: f32,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct TemporalRegion {
    pub offset: i32,
    pub x: usize,
    pub y: usize,
    pub width: usize,
    pub height: usize,
    pub tile_count: usize,
    pub mean_motion_defect: f32,
    pub mean_improvement: f32,
    pub mean_confidence: f32,
}

pub fn analyze_temporal_offsets(
    reference: &[[u32; GBA_PIXELS]],
    candidate: &[[u32; GBA_PIXELS]],
    max_offset: i32,
) -> TemporalAnalysis {
    assert!(max_offset >= 0, "max_offset must be non-negative");
    let global = analyze_global_temporal_offset(reference, candidate, max_offset);
    let mut tiles = Vec::new();

    for y in (0..GBA_H).step_by(TEMPORAL_TILE_SIZE) {
        for x in (0..GBA_W).step_by(TEMPORAL_TILE_SIZE) {
            let width = TEMPORAL_TILE_SIZE.min(GBA_W - x);
            let height = TEMPORAL_TILE_SIZE.min(GBA_H - y);
            tiles.push(analyze_tile_temporal_offset(
                reference, candidate, max_offset, x, y, width, height,
            ));
        }
    }

    let regions = temporal_regions(&tiles, GBA_W / TEMPORAL_TILE_SIZE, GBA_H / TEMPORAL_TILE_SIZE);

    TemporalAnalysis {
        max_offset,
        global,
        tile_size: TEMPORAL_TILE_SIZE,
        tile_grid_width: GBA_W / TEMPORAL_TILE_SIZE,
        tile_grid_height: GBA_H / TEMPORAL_TILE_SIZE,
        regions,
        tiles,
    }
}

pub fn temporal_offset_heatmap(analysis: &TemporalAnalysis) -> [u32; GBA_PIXELS] {
    let mut frame = [0xFF40_4040; GBA_PIXELS];
    for tile in &analysis.tiles {
        let color = temporal_offset_color(tile.best_offset, tile.confidence);
        for y in tile.y..(tile.y + tile.height) {
            for x in tile.x..(tile.x + tile.width) {
                frame[y * GBA_W + x] = color;
            }
        }
    }
    frame
}

fn temporal_offset_color(offset: Option<i32>, confidence: f32) -> u32 {
    let Some(offset) = offset else {
        return 0xFF40_4040;
    };
    if offset == 0 {
        return 0xFF60_D060;
    }

    let strength = (0.45 + confidence.min(0.15) * 3.0).min(1.0);
    let bright = (120.0 + 135.0 * strength) as u32;
    let dim = 48u32;
    if offset > 0 {
        // 0xAABBGGRR: blue means the candidate matches a later frame.
        0xFF00_0000 | (bright << 16) | (96 << 8) | dim
    } else {
        // Red means the candidate matches an earlier frame.
        0xFF00_0000 | (dim << 16) | (80 << 8) | bright
    }
}

fn analyze_global_temporal_offset(
    reference: &[[u32; GBA_PIXELS]],
    candidate: &[[u32; GBA_PIXELS]],
    max_offset: i32,
) -> TemporalOffsetEstimate {
    estimate_temporal_offset(max_offset, |offset| {
        mean_offset_defect(reference.len(), candidate.len(), offset, |r, c| {
            let mut defect = video::ssim_floored(&reference[r], &candidate[c]);
            if is_flat_frame(&candidate[c]) && !is_flat_frame(&reference[r]) {
                defect = 1.0;
            }
            defect
        })
    })
}

fn temporal_regions(
    tiles: &[TileTemporalOffset],
    grid_width: usize,
    grid_height: usize,
) -> Vec<TemporalRegion> {
    let mut visited = vec![false; tiles.len()];
    let mut regions = Vec::new();

    for start in 0..tiles.len() {
        if visited[start] || !tile_is_region_candidate(&tiles[start]) {
            continue;
        }
        let offset = tiles[start].best_offset.expect("region candidate has offset");
        let mut stack = vec![start];
        let mut members = Vec::new();
        visited[start] = true;

        while let Some(index) = stack.pop() {
            members.push(index);
            let gx = index % grid_width;
            let gy = index / grid_width;
            for (nx, ny) in tile_neighbors(gx, gy, grid_width, grid_height) {
                let next = ny * grid_width + nx;
                if visited[next] {
                    continue;
                }
                if tiles[next].best_offset == Some(offset) && tile_is_region_candidate(&tiles[next]) {
                    visited[next] = true;
                    stack.push(next);
                }
            }
        }

        regions.push(make_temporal_region(offset, tiles, &members));
    }

    regions.sort_by(|a, b| {
        b.tile_count
            .cmp(&a.tile_count)
            .then_with(|| {
                b.mean_improvement
                    .partial_cmp(&a.mean_improvement)
                    .unwrap_or(std::cmp::Ordering::Equal)
            })
            .then_with(|| a.y.cmp(&b.y))
            .then_with(|| a.x.cmp(&b.x))
    });
    regions
}

fn tile_is_region_candidate(tile: &TileTemporalOffset) -> bool {
    tile.best_offset.is_some()
        && tile.motion_defect >= STATIC_MOTION_DEFECT
        && tile.improvement >= REGION_MIN_IMPROVEMENT
}

fn tile_neighbors(
    x: usize,
    y: usize,
    grid_width: usize,
    grid_height: usize,
) -> impl Iterator<Item = (usize, usize)> {
    let mut out = Vec::with_capacity(4);
    if x > 0 {
        out.push((x - 1, y));
    }
    if x + 1 < grid_width {
        out.push((x + 1, y));
    }
    if y > 0 {
        out.push((x, y - 1));
    }
    if y + 1 < grid_height {
        out.push((x, y + 1));
    }
    out.into_iter()
}

fn make_temporal_region(
    offset: i32,
    tiles: &[TileTemporalOffset],
    members: &[usize],
) -> TemporalRegion {
    let mut min_x = usize::MAX;
    let mut min_y = usize::MAX;
    let mut max_x = 0usize;
    let mut max_y = 0usize;
    let mut motion = 0.0f32;
    let mut improvement = 0.0f32;
    let mut confidence = 0.0f32;

    for &index in members {
        let tile = &tiles[index];
        min_x = min_x.min(tile.x);
        min_y = min_y.min(tile.y);
        max_x = max_x.max(tile.x + tile.width);
        max_y = max_y.max(tile.y + tile.height);
        motion += tile.motion_defect;
        improvement += tile.improvement;
        confidence += tile.confidence;
    }

    let n = members.len() as f32;
    TemporalRegion {
        offset,
        x: min_x,
        y: min_y,
        width: max_x - min_x,
        height: max_y - min_y,
        tile_count: members.len(),
        mean_motion_defect: motion / n,
        mean_improvement: improvement / n,
        mean_confidence: confidence / n,
    }
}

fn analyze_tile_temporal_offset(
    reference: &[[u32; GBA_PIXELS]],
    candidate: &[[u32; GBA_PIXELS]],
    max_offset: i32,
    x: usize,
    y: usize,
    width: usize,
    height: usize,
) -> TileTemporalOffset {
    let motion_defect = reference_motion_defect(reference, x, y, width, height);
    let estimate = estimate_temporal_offset(max_offset, |offset| {
        mean_offset_defect(reference.len(), candidate.len(), offset, |r, c| {
            tile_pair_defect(&reference[r], &candidate[c], x, y, width, height)
        })
    });
    let best_offset = if motion_defect < STATIC_MOTION_DEFECT {
        None
    } else {
        estimate.best_offset
    };

    TileTemporalOffset {
        x,
        y,
        width,
        height,
        motion_defect,
        best_offset,
        lockstep_defect: estimate.lockstep_defect,
        best_defect: estimate.best_defect,
        improvement: estimate.improvement,
        confidence: offset_confidence(&estimate.offset_defects),
    }
}

fn estimate_temporal_offset(
    max_offset: i32,
    mut defect_for_offset: impl FnMut(i32) -> Option<OffsetDefect>,
) -> TemporalOffsetEstimate {
    let mut offset_defects = Vec::new();
    for offset in -max_offset..=max_offset {
        if let Some(defect) = defect_for_offset(offset) {
            offset_defects.push(defect);
        }
    }

    let lockstep_defect = offset_defects
        .iter()
        .find(|item| item.offset == 0)
        .map(|item| item.defect)
        .unwrap_or(1.0);
    let best = offset_defects
        .iter()
        .min_by(|a, b| compare_offset_defects(a, b));
    let (best_offset, best_defect) = match best {
        Some(item) => (Some(item.offset), item.defect),
        None => (None, lockstep_defect),
    };

    TemporalOffsetEstimate {
        best_offset,
        lockstep_defect,
        best_defect,
        improvement: (lockstep_defect - best_defect).max(0.0),
        offset_defects,
    }
}

fn compare_offset_defects(a: &OffsetDefect, b: &OffsetDefect) -> std::cmp::Ordering {
    const EPS: f32 = 1.0e-7;
    if (a.defect - b.defect).abs() > EPS {
        return a
            .defect
            .partial_cmp(&b.defect)
            .unwrap_or(std::cmp::Ordering::Equal);
    }
    let a_abs = a.offset.abs();
    let b_abs = b.offset.abs();
    a_abs.cmp(&b_abs).then_with(|| a.offset.cmp(&b.offset))
}

fn offset_confidence(offset_defects: &[OffsetDefect]) -> f32 {
    if offset_defects.len() < 2 {
        return 0.0;
    }
    let mut defects = offset_defects
        .iter()
        .map(|item| item.defect)
        .collect::<Vec<_>>();
    defects.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    (defects[1] - defects[0]).max(0.0)
}

fn mean_offset_defect(
    reference_len: usize,
    candidate_len: usize,
    offset: i32,
    mut pair_defect: impl FnMut(usize, usize) -> f32,
) -> Option<OffsetDefect> {
    let mut sum = 0.0f32;
    let mut count = 0usize;

    for ref_index in 0..reference_len {
        let cand_index = ref_index as i32 + offset;
        if cand_index < 0 || cand_index >= candidate_len as i32 {
            continue;
        }
        sum += pair_defect(ref_index, cand_index as usize);
        count += 1;
    }

    (count > 0).then_some(OffsetDefect {
        offset,
        defect: sum / count as f32,
        overlap_frames: count,
    })
}

fn reference_motion_defect(
    reference: &[[u32; GBA_PIXELS]],
    x: usize,
    y: usize,
    width: usize,
    height: usize,
) -> f32 {
    if reference.len() < 2 {
        return 0.0;
    }
    let mut sum = 0.0f32;
    for index in 1..reference.len() {
        sum += tile_pair_defect(
            &reference[index - 1],
            &reference[index],
            x,
            y,
            width,
            height,
        );
    }
    sum / (reference.len() - 1) as f32
}

fn tile_pair_defect(
    reference: &[u32; GBA_PIXELS],
    candidate: &[u32; GBA_PIXELS],
    x: usize,
    y: usize,
    width: usize,
    height: usize,
) -> f32 {
    let mut diff = 0usize;
    let mut total = 0usize;
    for py in y..(y + height) {
        for px in x..(x + width) {
            let index = py * GBA_W + px;
            if quant5(reference[index]) != quant5(candidate[index]) {
                diff += 1;
            }
            total += 1;
        }
    }
    if total == 0 {
        0.0
    } else {
        diff as f32 / total as f32
    }
}

fn replay_score_deduped(histogram: &[f32], new_run: &[bool], tau: f32) -> f32 {
    let mut run_sum = 0.0f64;
    let mut run_len = 0u32;
    let mut run_count = 0u32;
    let mut deduped = 0.0f64;

    for (index, &defect) in histogram.iter().enumerate() {
        if new_run[index] && run_len > 0 {
            deduped += run_sum / run_len as f64;
            run_count += 1;
            run_sum = 0.0;
            run_len = 0;
        }
        run_sum += CompareResult::frame_score(defect, tau);
        run_len += 1;
    }
    if run_len > 0 {
        deduped += run_sum / run_len as f64;
        run_count += 1;
    }

    if run_count > 0 {
        (deduped / run_count as f64) as f32
    } else {
        1.0
    }
}
