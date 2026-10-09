import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

/** The video's frame rate. */
export const FPS = 30;

/** ffmpeg, quiet but for its errors; a missing ffmpeg says how to get one. */
export function ffmpeg(...args: string[]) {
  try {
    execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], { stdio: ["ignore", "ignore", "inherit"] });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error("make demo needs ffmpeg on PATH to write the MP4 (macOS: brew install ffmpeg; Debian/Ubuntu: apt install ffmpeg)");
    }
    throw error;
  }
}

/**
 * The frames, each held until the next one arrived, as a constant-rate 1080p H.264 MP4. A screencast
 * only sends a frame when the page changes, so the timing is the frames' own: ffmpeg's concat
 * demuxer takes a duration per file, and `fps` fills the still stretches. The timestamps' unit is
 * not documented, so a gap is read as milliseconds when the median one would otherwise be seconds.
 */
export function encode(dir: string, shot: { name: string; at: number }[], out: string) {
  if (shot.length < 2) throw new Error(`the screencast sent ${shot.length} frame(s); nothing to encode`);
  // Frames can arrive out of their timestamps' order, and a negative duration is one the concat demuxer
  // refuses outright: they are put in time order, and a gap never goes below a tenth of a millisecond.
  const ordered = [...shot].sort((a, b) => a.at - b.at);
  const gaps = ordered.slice(1).map((f, i) => f.at - ordered[i].at);
  const median = [...gaps].sort((a, b) => a - b)[Math.floor(gaps.length / 2)];
  const unit = median > 1 ? 1000 : 1;
  const lines = ordered.flatMap((f, i) => [
    `file '${f.name}'`,
    `duration ${Math.max((gaps[i] ?? unit / FPS) / unit, 0.0001).toFixed(4)}`,
  ]);
  // The concat demuxer drops the last entry's duration unless the file is named once more.
  lines.push(`file '${ordered[ordered.length - 1].name}'`);
  const list = join(dir, "frames.txt");
  writeFileSync(list, `${lines.join("\n")}\n`);
  ffmpeg(
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    list,
    "-vf",
    `fps=${FPS}`,
    "-an",
    "-c:v",
    "libx264",
    "-preset",
    "slow",
    "-crf",
    "18",
    // A keyframe a second: a page seeking to a step lands at once instead of decoding from the last one.
    "-g",
    String(FPS),
    "-keyint_min",
    String(FPS),
    "-sc_threshold",
    "0",
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    out,
  );
}
