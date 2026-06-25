export function frameName(kind, index, extension = "png") {
  return `${kind}/frame_${String(index).padStart(4, "0")}.${extension}`;
}

export function createZip(entries) {
  const encoder = new TextEncoder();
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const bytes = entry.bytes instanceof Uint8Array ? entry.bytes : new Uint8Array(entry.bytes);
    const crc = crc32(bytes);

    const local = new BinaryWriter(30 + name.length + bytes.length);
    local.u32(0x04034b50);
    local.u16(20);
    local.u16(0);
    local.u16(0);
    local.u16(0);
    local.u16(0);
    local.u32(crc);
    local.u32(bytes.length);
    local.u32(bytes.length);
    local.u16(name.length);
    local.u16(0);
    local.bytes(name);
    local.bytes(bytes);
    localParts.push(local.buffer);

    const central = new BinaryWriter(46 + name.length);
    central.u32(0x02014b50);
    central.u16(20);
    central.u16(20);
    central.u16(0);
    central.u16(0);
    central.u16(0);
    central.u16(0);
    central.u32(crc);
    central.u32(bytes.length);
    central.u32(bytes.length);
    central.u16(name.length);
    central.u16(0);
    central.u16(0);
    central.u16(0);
    central.u16(0);
    central.u32(0);
    central.u32(offset);
    central.bytes(name);
    centralParts.push(central.buffer);
    offset += local.buffer.length;
  }

  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const end = new BinaryWriter(22);
  end.u32(0x06054b50);
  end.u16(0);
  end.u16(0);
  end.u16(entries.length);
  end.u16(entries.length);
  end.u32(centralSize);
  end.u32(offset);
  end.u16(0);

  return concatBytes([...localParts, ...centralParts, end.buffer]);
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

class BinaryWriter {
  constructor(size) {
    this.buffer = new Uint8Array(size);
    this.view = new DataView(this.buffer.buffer);
    this.offset = 0;
  }

  u16(value) {
    this.view.setUint16(this.offset, value, true);
    this.offset += 2;
  }

  u32(value) {
    this.view.setUint32(this.offset, value >>> 0, true);
    this.offset += 4;
  }

  bytes(value) {
    this.buffer.set(value, this.offset);
    this.offset += value.length;
  }
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
