import { deflateSync } from "node:zlib";

export const WIDTH = 240;
export const HEIGHT = 160;
export const PIXELS = WIDTH * HEIGHT;
export const FRAME_BYTES = PIXELS * 4;

export function parseReplayText(text) {
  const replay = {
    recording: "",
    date: "",
    totalFrames: 0,
    events: [],
  };

  for (const rawLine of text.split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    if (!trimmed) continue;

    if (trimmed.startsWith("#")) {
      const comment = trimmed.slice(1).trim();
      const [key, ...rest] = comment.split(":");
      const value = rest.join(":").trim();
      if (/^Recording$/i.test(key)) replay.recording = value;
      if (/^Date$/i.test(key)) replay.date = value;
      if (/^Total frames$/i.test(key)) replay.totalFrames = Number.parseInt(value, 10) || 0;
      continue;
    }

    const [frameText, keysText] = trimmed.split(/\s+/);
    const frame = Number.parseInt(frameText, 10);
    const keys = Number.parseInt(keysText, 16);
    if (Number.isFinite(frame) && Number.isFinite(keys)) {
      replay.events.push({ frame, keys: keys & 0xffff });
    }
  }

  replay.events.sort((a, b) => a.frame - b.frame);
  if (!replay.totalFrames) {
    replay.totalFrames = replay.events.at(-1)?.frame ?? 0;
  }
  return replay;
}

export function keysAt(replay, frame) {
  let keys = 0;
  for (const event of replay.events) {
    if (event.frame > frame) break;
    keys = event.keys;
  }
  return keys;
}

export function frameName(kind, index, extension = "png") {
  return `${kind}/frame_${String(index).padStart(4, "0")}.${extension}`;
}

export function selectFrameRange({ totalFrames, frames, last = false }) {
  const frameCount = Number.parseInt(frames, 10);
  const total = Number.parseInt(totalFrames, 10);
  if (!Number.isFinite(frameCount) || frameCount <= 0) {
    throw new Error("frames must be a positive integer");
  }
  if (!Number.isFinite(total) || total <= 0) {
    throw new Error("totalFrames must be a positive integer");
  }

  const captureFrames = Math.min(frameCount, total);
  const startFrame = last ? total - captureFrames : 0;
  return {
    startFrame,
    endFrame: startFrame + captureFrames,
    captureFrames,
  };
}

export function writeDiffImage(reference, candidate, output, pixels = PIXELS) {
  let changed = 0;
  for (let pixel = 0; pixel < pixels; pixel += 1) {
    const offset = pixel * 4;
    const diff =
      Math.abs((reference[offset] >> 3) - (candidate[offset] >> 3)) +
      Math.abs((reference[offset + 1] >> 3) - (candidate[offset + 1] >> 3)) +
      Math.abs((reference[offset + 2] >> 3) - (candidate[offset + 2] >> 3));

    if (diff === 0) {
      output[offset] = 0;
      output[offset + 1] = 0;
      output[offset + 2] = 0;
      output[offset + 3] = 255;
    } else {
      changed += 1;
      const [red, green, blue] = heatColor(diff);
      output[offset] = red;
      output[offset + 1] = green;
      output[offset + 2] = blue;
      output[offset + 3] = 255;
    }
  }
  return changed;
}

export function heatColor(diff) {
  const ratio = Math.min(diff / 30, 1);
  if (ratio < 0.25) {
    const t = ratio * 4;
    return [68 + t * -9, 1 + t * 81, 84 + t * 55].map(Math.round);
  }
  if (ratio < 0.5) {
    const t = (ratio - 0.25) * 4;
    return [59 + t * -26, 82 + t * 63, 139 + t].map(Math.round);
  }
  if (ratio < 0.75) {
    const t = (ratio - 0.5) * 4;
    return [33 + t * 61, 145 + t * 56, 140 + t * -42].map(Math.round);
  }
  const t = (ratio - 0.75) * 4;
  return [94 + t * 159, 201 + t * 30, 98 + t * -61].map(Math.round);
}

export function encodePngRgba(rgba, width = WIDTH, height = HEIGHT) {
  if (rgba.length !== width * height * 4) {
    throw new Error(`RGBA length ${rgba.length} does not match ${width}x${height}`);
  }

  const stride = width * 4;
  const raw = new Uint8Array((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const rawOffset = y * (stride + 1);
    raw[rawOffset] = 0;
    raw.set(rgba.subarray(y * stride, (y + 1) * stride), rawOffset + 1);
  }

  return concatBytes([
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", ihdr(width, height)),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", new Uint8Array()),
  ]);
}

function ihdr(width, height) {
  const bytes = new Uint8Array(13);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  bytes[8] = 8;
  bytes[9] = 6;
  bytes[10] = 0;
  bytes[11] = 0;
  bytes[12] = 0;
  return bytes;
}

function pngChunk(type, data) {
  const typeBytes = new TextEncoder().encode(type);
  const chunk = new Uint8Array(12 + data.length);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, data.length);
  chunk.set(typeBytes, 4);
  chunk.set(data, 8);
  view.setUint32(8 + data.length, crc32(chunk.subarray(4, 8 + data.length)));
  return chunk;
}

function concatBytes(parts) {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const output = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

let crcTable = null;

function crc32(bytes) {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) {
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      }
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
