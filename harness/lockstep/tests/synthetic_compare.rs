use lockstep::synthetic_compare::{
    analyze_temporal_offsets, compare_framebuffers_lockstep, temporal_offset_heatmap,
    temporal_region_overlay, synthetic_compare_report,
};
use lockstep::{GBA_H, GBA_PIXELS, GBA_W};

fn solid(px: u32) -> [u32; GBA_PIXELS] {
    [px; GBA_PIXELS]
}

fn snow_frame(time: usize) -> [u32; GBA_PIXELS] {
    let mut frame = solid(0xFF2A_140C);
    for i in 0..20 {
        let x = (11 + i * 37 + time * 2) % GBA_W;
        let y = (7 + i * 19 + time * (1 + i % 3)) % GBA_H;
        let px = 0xFFFF_FFFF;
        frame[y * GBA_W + x] = px;
        if x + 1 < GBA_W {
            frame[y * GBA_W + x + 1] = px;
        }
        if y + 1 < GBA_H {
            frame[(y + 1) * GBA_W + x] = px;
        }
    }
    frame
}

fn snow_frame_signed(time: isize) -> [u32; GBA_PIXELS] {
    let wrapped = time.rem_euclid(10_000) as usize;
    snow_frame(wrapped)
}

fn menu_snow_scene(time: isize) -> [u32; GBA_PIXELS] {
    let mut frame = solid(0xFF24_1810);

    // Static menu area on the left.
    for y in 18..142 {
        for x in 12..96 {
            frame[y * GBA_W + x] = 0xFF38_3028;
        }
    }
    for &(x0, y0, w, h) in &[(28, 36, 44, 10), (28, 68, 58, 10), (28, 100, 44, 10)] {
        for y in y0..(y0 + h) {
            for x in x0..(x0 + w) {
                frame[y * GBA_W + x] = 0xFFE8_E8_E8;
            }
        }
    }

    // Moving snow-like particles only on the right side.
    for i in 0..26 {
        let x = 126 + (i as isize * 17 + time * 3).rem_euclid(102) as usize;
        let y = 8 + (i as isize * 23 + time * (2 + (i % 3) as isize)).rem_euclid(134) as usize;
        for dy in 0..3 {
            for dx in 0..3 {
                let px = x + dx;
                let py = y + dy;
                if px < GBA_W && py < GBA_H {
                    frame[py * GBA_W + px] = 0xFFFF_FFFF;
                }
            }
        }
    }

    frame
}

#[test]
fn identical_sequences_score_one() {
    let reference = vec![solid(0xFF2A_140C); 6];
    let candidate = vec![solid(0xFF2A_140C); 6];

    let result = compare_framebuffers_lockstep(&reference, &candidate);

    assert_eq!(result.n_frames, 6);
    assert_eq!(result.video_score(), 1.0);
    assert!(result.histogram.iter().all(|&d| d == 0.0));
}

#[test]
fn time_shifted_snow_scores_poorly_in_lockstep() {
    let reference: Vec<_> = (0..18).map(snow_frame).collect();
    let candidate: Vec<_> = (0..18).map(|t| snow_frame(t + 2)).collect();

    let result = compare_framebuffers_lockstep(&reference, &candidate);

    assert!(
        result.video_score() < 0.5,
        "score was {}",
        result.video_score()
    );
    assert!(result.histogram.iter().any(|&d| d > 0.0));
}

#[test]
fn temporal_analysis_detects_global_frame_offset() {
    let reference: Vec<_> = (0..18).map(|t| snow_frame_signed(t)).collect();
    let candidate: Vec<_> = (0..20).map(|t| snow_frame_signed(t - 2)).collect();

    let analysis = analyze_temporal_offsets(&reference, &candidate, 3);

    assert_eq!(analysis.global.best_offset, Some(2));
    assert!(analysis.global.best_defect < analysis.global.lockstep_defect);
}

#[test]
fn temporal_analysis_localizes_offset_to_moving_region() {
    let reference: Vec<_> = (0..18).map(|t| menu_snow_scene(t)).collect();
    let candidate: Vec<_> = (0..20).map(|t| menu_snow_scene(t - 2)).collect();

    let analysis = analyze_temporal_offsets(&reference, &candidate, 3);

    assert_eq!(analysis.global.best_offset, Some(2));

    let static_menu_tiles = analysis
        .tiles
        .iter()
        .filter(|tile| tile.x < 100 && tile.motion_defect < 0.001)
        .count();
    assert!(static_menu_tiles > 20);

    let shifted_snow_tiles = analysis
        .tiles
        .iter()
        .filter(|tile| tile.x >= 120 && tile.best_offset == Some(2) && tile.improvement > 0.0)
        .count();
    assert!(shifted_snow_tiles > 0);

    let shifted_regions = analysis
        .regions
        .iter()
        .filter(|region| {
            region.offset == 2
                && region.x >= 120
                && region.tile_count > 1
                && region.mean_improvement > 0.0
        })
        .count();
    assert!(shifted_regions > 0);
}

#[test]
fn temporal_summary_reports_global_and_top_local_offsets() {
    let reference: Vec<_> = (0..18).map(|t| menu_snow_scene(t)).collect();
    let candidate: Vec<_> = (0..20).map(|t| menu_snow_scene(t - 2)).collect();

    let analysis = analyze_temporal_offsets(&reference, &candidate, 3);

    assert_eq!(analysis.summary.global_best_offset, Some(2));
    assert!(analysis.summary.global_improvement > 0.0);
    assert_eq!(analysis.summary.region_count, analysis.regions.len());
    assert!(
        analysis
            .summary
            .top_regions
            .iter()
            .any(|region| region.offset == 2 && region.x >= 120 && region.tile_count > 1)
    );
}

#[test]
fn summary_report_keeps_temporal_conclusion_without_full_details() {
    let reference: Vec<_> = (0..18).map(|t| menu_snow_scene(t)).collect();
    let candidate: Vec<_> = (0..20).map(|t| menu_snow_scene(t - 2)).collect();
    let result = compare_framebuffers_lockstep(&reference, &candidate);
    let analysis = analyze_temporal_offsets(&reference, &candidate, 3);

    let report = synthetic_compare_report(&result, Some(&analysis), false);

    assert!(report.get("video_score").is_some());
    assert_eq!(report["temporal_summary"]["global_best_offset"], 2);
    assert!(report["temporal_summary"]["top_regions"]
        .as_array()
        .is_some_and(|regions| !regions.is_empty()));
    assert!(report.get("histogram").is_none());
    assert!(report.get("temporal_analysis").is_none());
}

#[test]
fn temporal_heatmap_marks_static_and_shifted_regions_differently() {
    let reference: Vec<_> = (0..18).map(|t| menu_snow_scene(t)).collect();
    let candidate: Vec<_> = (0..20).map(|t| menu_snow_scene(t - 2)).collect();
    let analysis = analyze_temporal_offsets(&reference, &candidate, 3);

    let heatmap = temporal_offset_heatmap(&analysis);
    let shifted_tile = analysis
        .tiles
        .iter()
        .find(|tile| tile.x >= 120 && tile.best_offset == Some(2))
        .expect("expected a shifted tile");

    let static_menu_px = heatmap[40 * GBA_W + 20];
    let shifted_px = heatmap[(shifted_tile.y + 1) * GBA_W + shifted_tile.x + 1];

    assert_ne!(static_menu_px, shifted_px);
}

#[test]
fn temporal_region_overlay_draws_boxes_on_reference_frame() {
    let reference: Vec<_> = (0..18).map(|t| menu_snow_scene(t)).collect();
    let candidate: Vec<_> = (0..20).map(|t| menu_snow_scene(t - 2)).collect();
    let analysis = analyze_temporal_offsets(&reference, &candidate, 3);

    let region = analysis
        .regions
        .iter()
        .find(|region| region.offset == 2 && region.x >= 120 && region.tile_count > 1)
        .expect("expected a shifted region");
    let overlay = temporal_region_overlay(&reference[0], &analysis);

    let untouched_menu_px = overlay[40 * GBA_W + 20];
    let region_border_px = overlay[region.y * GBA_W + region.x];

    assert_eq!(untouched_menu_px, reference[0][40 * GBA_W + 20]);
    assert_ne!(region_border_px, reference[0][region.y * GBA_W + region.x]);
}
