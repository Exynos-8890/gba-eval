use std::fs;
use std::path::{Path, PathBuf};

use lockstep::media::write_png;
use lockstep::synthetic_compare::{
    analyze_temporal_offsets, compare_framebuffers_lockstep, temporal_offset_heatmap,
    temporal_region_overlay, synthetic_compare_report,
};
use lockstep::{GBA_H, GBA_PIXELS, GBA_W};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args = Args::parse()?;
    let reference = load_png_sequence(&args.reference)?;
    let candidate = load_png_sequence(&args.candidate)?;
    let result = compare_framebuffers_lockstep(&reference, &candidate);
    let temporal_analysis = args
        .temporal_window
        .map(|window| analyze_temporal_offsets(&reference, &candidate, window));
    if let (Some(analysis), Some(path)) = (&temporal_analysis, &args.temporal_heatmap_out) {
        write_png(path, &temporal_offset_heatmap(analysis))?;
    }
    if let (Some(analysis), Some(path)) = (&temporal_analysis, &args.temporal_region_overlay_out) {
        write_png(path, &temporal_region_overlay(&reference[0], analysis))?;
    }

    println!(
        "{}",
        serde_json::to_string_pretty(&synthetic_compare_report(
            &result,
            temporal_analysis.as_ref(),
            !args.summary_only,
        ))?
    );
    Ok(())
}

struct Args {
    reference: PathBuf,
    candidate: PathBuf,
    temporal_window: Option<i32>,
    temporal_heatmap_out: Option<PathBuf>,
    temporal_region_overlay_out: Option<PathBuf>,
    summary_only: bool,
}

impl Args {
    fn parse() -> Result<Self, Box<dyn std::error::Error>> {
        let mut reference = None;
        let mut candidate = None;
        let mut temporal_window = None;
        let mut temporal_heatmap_out = None;
        let mut temporal_region_overlay_out = None;
        let mut summary_only = false;
        let mut args = std::env::args().skip(1);

        while let Some(arg) = args.next() {
            match arg.as_str() {
                "--reference" => reference = args.next().map(PathBuf::from),
                "--candidate" => candidate = args.next().map(PathBuf::from),
                "--temporal-window" => {
                    let value = args
                        .next()
                        .ok_or("--temporal-window needs a non-negative integer")?;
                    let parsed = value.parse::<i32>()?;
                    if parsed < 0 {
                        return Err("--temporal-window must be non-negative".into());
                    }
                    temporal_window = Some(parsed);
                }
                "--temporal-heatmap-out" => temporal_heatmap_out = args.next().map(PathBuf::from),
                "--temporal-region-overlay-out" => {
                    temporal_region_overlay_out = args.next().map(PathBuf::from)
                }
                "--summary-only" => summary_only = true,
                "--help" | "-h" => {
                    print_usage();
                    std::process::exit(0);
                }
                other => return Err(format!("unknown argument: {other}").into()),
            }
        }

        if (temporal_heatmap_out.is_some() || temporal_region_overlay_out.is_some())
            && temporal_window.is_none()
        {
            return Err("temporal image outputs require --temporal-window".into());
        }
        if summary_only && temporal_window.is_none() {
            return Err("--summary-only requires --temporal-window".into());
        }

        match (reference, candidate) {
            (Some(reference), Some(candidate)) => Ok(Self {
                reference,
                candidate,
                temporal_window,
                temporal_heatmap_out,
                temporal_region_overlay_out,
                summary_only,
            }),
            _ => {
                print_usage();
                Err("missing --reference or --candidate".into())
            }
        }
    }
}

fn print_usage() {
    eprintln!(
        "usage: synthetic_compare --reference ref_png_dir --candidate candidate_png_dir [--temporal-window N] [--summary-only] [--temporal-heatmap-out out.png] [--temporal-region-overlay-out out.png]"
    );
}

fn load_png_sequence(path: &Path) -> Result<Vec<[u32; GBA_PIXELS]>, Box<dyn std::error::Error>> {
    let mut entries = fs::read_dir(path)?
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| {
            path.extension()
                .is_some_and(|ext| ext.to_string_lossy().eq_ignore_ascii_case("png"))
        })
        .collect::<Vec<_>>();
    entries.sort();

    if entries.is_empty() {
        return Err(format!("no png frames found in {}", path.display()).into());
    }

    entries.iter().map(|path| load_png_frame(path)).collect()
}

fn load_png_frame(path: &Path) -> Result<[u32; GBA_PIXELS], Box<dyn std::error::Error>> {
    let file = fs::File::open(path)?;
    let decoder = png::Decoder::new(file);
    let mut reader = decoder.read_info()?;
    let mut buffer = vec![0; reader.output_buffer_size()];
    let info = reader.next_frame(&mut buffer)?;
    let bytes = &buffer[..info.buffer_size()];

    if info.width as usize != GBA_W || info.height as usize != GBA_H {
        return Err(format!(
            "{}: expected {GBA_W}x{GBA_H}, got {}x{}",
            path.display(),
            info.width,
            info.height
        )
        .into());
    }
    if info.bit_depth != png::BitDepth::Eight {
        return Err(format!("{}: expected 8-bit PNG", path.display()).into());
    }

    let channels = match info.color_type {
        png::ColorType::Rgb => 3,
        png::ColorType::Rgba => 4,
        other => {
            return Err(format!("{}: unsupported PNG color type {other:?}", path.display()).into())
        }
    };

    let mut frame = [0u32; GBA_PIXELS];
    for (index, pixel) in bytes.chunks_exact(channels).enumerate() {
        let r = pixel[0] as u32;
        let g = pixel[1] as u32;
        let b = pixel[2] as u32;
        frame[index] = 0xFF00_0000 | (b << 16) | (g << 8) | r;
    }
    Ok(frame)
}
