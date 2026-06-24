use lockstep::synthetic_compare::compare_framebuffers_lockstep;
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

    assert!(result.video_score() < 0.5, "score was {}", result.video_score());
    assert!(result.histogram.iter().any(|&d| d > 0.0));
}
