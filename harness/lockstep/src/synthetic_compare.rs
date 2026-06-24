use crate::result::CompareResult;
use crate::video;
use crate::{diff_frame, is_flat_frame, luma_mae, ref_in_motion, GBA_PIXELS, NOISE_FLOOR};

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
    result.replay_score_deduped = replay_score_deduped(&result.histogram, &new_run, result.frame_diff_threshold);
    result
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
