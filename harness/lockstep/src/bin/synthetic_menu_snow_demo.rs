use std::path::PathBuf;

use lockstep::media::write_png;
use lockstep::synthetic_compare::menu_snow_demo_sequences;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args = Args::parse()?;
    let reference_dir = args.out.join("reference");
    let candidate_dir = args.out.join("candidate");
    std::fs::create_dir_all(&reference_dir)?;
    std::fs::create_dir_all(&candidate_dir)?;

    let (reference, candidate) =
        menu_snow_demo_sequences(args.reference_frames, args.candidate_frames, args.delay);
    for (index, frame) in reference.iter().enumerate() {
        write_png(&reference_dir.join(format!("frame_{index:04}.png")), frame)?;
    }
    for (index, frame) in candidate.iter().enumerate() {
        write_png(&candidate_dir.join(format!("frame_{index:04}.png")), frame)?;
    }

    println!("{}", args.out.display());
    Ok(())
}

struct Args {
    out: PathBuf,
    reference_frames: usize,
    candidate_frames: usize,
    delay: isize,
}

impl Args {
    fn parse() -> Result<Self, Box<dyn std::error::Error>> {
        let mut out = None;
        let mut reference_frames = 24usize;
        let mut candidate_frames = 26usize;
        let mut delay = 2isize;
        let mut args = std::env::args().skip(1);

        while let Some(arg) = args.next() {
            match arg.as_str() {
                "--out" => out = args.next().map(PathBuf::from),
                "--frames" => {
                    reference_frames = args
                        .next()
                        .ok_or("--frames needs an integer")?
                        .parse::<usize>()?;
                }
                "--candidate-frames" => {
                    candidate_frames = args
                        .next()
                        .ok_or("--candidate-frames needs an integer")?
                        .parse::<usize>()?;
                }
                "--delay" => {
                    delay = args
                        .next()
                        .ok_or("--delay needs an integer")?
                        .parse::<isize>()?;
                }
                "--help" | "-h" => {
                    print_usage();
                    std::process::exit(0);
                }
                other => return Err(format!("unknown argument: {other}").into()),
            }
        }

        let Some(out) = out else {
            print_usage();
            return Err("missing --out".into());
        };
        if reference_frames == 0 || candidate_frames == 0 {
            return Err("--frames and --candidate-frames must be positive".into());
        }

        Ok(Self {
            out,
            reference_frames,
            candidate_frames,
            delay,
        })
    }
}

fn print_usage() {
    eprintln!(
        "usage: synthetic_menu_snow_demo --out out_dir [--frames 24] [--candidate-frames 26] [--delay 2]"
    );
}
