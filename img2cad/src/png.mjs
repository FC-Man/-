// PNG 解码/编码（零依赖：8/16 位，灰度/RGB/调色板/带透明）
import zlib from 'node:zlib';

const SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export function isPNG(buf) {
  return buf.length > 8 && buf.subarray(0, 8).equals(SIG);
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

/** 解码为 { width, height, gray:Uint8Array, alpha:Uint8Array } */
export function decodePNG(buf) {
  if (!isPNG(buf)) throw new Error('不是 PNG 文件');
  let p = 8, w = 0, h = 0, bitDepth = 8, colorType = 6, interlace = 0;
  let plte = null, trns = null;
  const idat = [];
  while (p + 8 <= buf.length) {
    const len = buf.readUInt32BE(p);
    const type = buf.toString('latin1', p + 4, p + 8);
    const data = buf.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0); h = data.readUInt32BE(4);
      bitDepth = data[8]; colorType = data[9]; interlace = data[12];
    } else if (type === 'PLTE') plte = Buffer.from(data);
    else if (type === 'tRNS') trns = Buffer.from(data);
    else if (type === 'IDAT') idat.push(Buffer.from(data));
    else if (type === 'IEND') break;
    p += 12 + len;
  }
  if (!w || !h) throw new Error('PNG 头损坏');
  if (interlace) throw new Error('不支持隔行(interlaced) PNG，请另存为普通 PNG');
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
  if (!channels) throw new Error('不支持的 PNG 颜色类型 ' + colorType);
  if (![1, 2, 4, 8, 16].includes(bitDepth)) throw new Error('不支持的位深 ' + bitDepth);
  if (colorType === 3 && !plte) throw new Error('调色板 PNG 缺少 PLTE');

  const raw = zlib.inflateSync(Buffer.concat(idat));
  const rowSamples = w * channels;
  const rowBytes = Math.ceil((rowSamples * bitDepth) / 8);
  const bpp = Math.max(1, Math.ceil((channels * bitDepth) / 8));
  let prev = Buffer.alloc(rowBytes);
  let off = 0;

  const gray = new Uint8Array(w * h);
  const alpha = new Uint8Array(w * h).fill(255);

  for (let y = 0; y < h; y++) {
    const filter = raw[off++];
    const row = Buffer.from(raw.subarray(off, off + rowBytes));
    off += rowBytes;
    for (let i = 0; i < rowBytes; i++) {
      const a = i >= bpp ? row[i - bpp] : 0;
      const b = prev[i];
      const c = i >= bpp ? prev[i - bpp] : 0;
      let v = row[i];
      switch (filter) {
        case 0: break;
        case 1: v = (v + a) & 0xff; break;
        case 2: v = (v + b) & 0xff; break;
        case 3: v = (v + ((a + b) >> 1)) & 0xff; break;
        case 4: v = (v + paeth(a, b, c)) & 0xff; break;
        default: throw new Error('未知 PNG 行滤波 ' + filter);
      }
      row[i] = v;
    }
    prev = row;

    const samples = new Uint8Array(rowSamples);
    if (bitDepth === 8) samples.set(row.subarray(0, rowSamples));
    else if (bitDepth === 16) { for (let i = 0; i < rowSamples; i++) samples[i] = row[i * 2]; }
    else {
      const perByte = 8 / bitDepth;
      const mask = (1 << bitDepth) - 1;
      for (let i = 0; i < rowSamples; i++) {
        const byte = row[Math.floor(i / perByte)];
        const shift = 8 - bitDepth * ((i % perByte) + 1);
        samples[i] = (byte >> shift) & mask;
      }
      if (colorType === 0) {
        const scale = 255 / mask;
        for (let i = 0; i < rowSamples; i++) samples[i] = Math.round(samples[i] * scale);
      }
    }

    const base = y * w;
    if (colorType === 3) {
      for (let x = 0; x < w; x++) {
        const pi = samples[x];
        gray[base + x] = Math.round(0.299 * plte[pi * 3] + 0.587 * plte[pi * 3 + 1] + 0.114 * plte[pi * 3 + 2]);
        if (trns && pi < trns.length) alpha[base + x] = trns[pi];
      }
    } else if (colorType === 0) {
      for (let x = 0; x < w; x++) gray[base + x] = samples[x];
    } else if (colorType === 4) {
      for (let x = 0; x < w; x++) { gray[base + x] = samples[x * 2]; alpha[base + x] = samples[x * 2 + 1]; }
    } else if (colorType === 2) {
      for (let x = 0; x < w; x++) gray[base + x] = Math.round(0.299 * samples[x * 3] + 0.587 * samples[x * 3 + 1] + 0.114 * samples[x * 3 + 2]);
    } else {
      for (let x = 0; x < w; x++) {
        gray[base + x] = Math.round(0.299 * samples[x * 4] + 0.587 * samples[x * 4 + 1] + 0.114 * samples[x * 4 + 2]);
        alpha[base + x] = samples[x * 4 + 3];
      }
    }
  }
  return { width: w, height: h, gray, alpha };
}

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, 'latin1');
  let crc = -1;
  const body = Buffer.concat([t, data]);
  for (let i = 0; i < body.length; i++) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ body[i]) & 0xff];
  crc = (crc ^ -1) >>> 0;
  const crcBuf = Buffer.alloc(4); crcBuf.writeUInt32BE(crc, 0);
  return Buffer.concat([len, t, data, crcBuf]);
}

/** rgb: Uint8Array(w*h*3) 或 Buffer */
export function encodePNG(width, height, rgb) {
  const src = Buffer.isBuffer(rgb) ? rgb : Buffer.from(rgb.buffer, rgb.byteOffset, rgb.length);
  const stride = width * 3 + 1;
  const raw = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    raw[y * stride] = 0;
    src.copy(raw, y * stride + 1, y * width * 3, (y + 1) * width * 3);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([SIG, chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
