// Minimal ZIP writer that assembles the archive as a Blob made of parts.
//
// Downloaded files are added as Blobs and stored uncompressed (they are
// mostly PDFs/Office/images that are already compressed), so their bytes are
// never copied into JavaScript memory: the final Blob just references them
// and Chrome's blob storage can page large data to disk. Generated text files
// (metadata, descriptions, reports) are deflated when that makes them smaller.
//
// Features: UTF-8 file names (general purpose bit 11), DOS timestamps, Unix
// permissions, and ZIP64 records when sizes/offsets/counts exceed the classic
// limits (or when forced, for testing).

import { crc32, crc32OfBlob } from './crc32.js';

const MAX32 = 0xffffffff;
const MAX16 = 0xffff;
const encoder = new TextEncoder();

function dosDateTime(date) {
  const d = date instanceof Date && !Number.isNaN(date.getTime()) ? date : new Date();
  const year = Math.min(Math.max(d.getFullYear(), 1980), 2107);
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
  const day = ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time, day };
}

function setUint64(view, offset, value) {
  view.setUint32(offset, value % 0x100000000, true);
  view.setUint32(offset + 4, Math.floor(value / 0x100000000), true);
}

async function deflateRaw(bytes) {
  if (typeof CompressionStream === 'undefined') return null;
  try {
    const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch (_) {
    return null;
  }
}

/** Normalize an archive path: forward slashes, no leading slash, no "..". */
export function normalizeZipPath(path) {
  const parts = String(path)
    .replace(/\\/g, '/')
    .split('/')
    .filter((p) => p && p !== '.' && p !== '..');
  if (!parts.length) throw new Error(`Invalid archive path: ${path}`);
  return parts.join('/');
}

export class ZipWriter {
  constructor({ date = new Date(), forceZip64 = false } = {}) {
    this.parts = [];
    this.entries = [];
    this.offset = 0;
    this.names = new Set();
    this.forceZip64 = forceZip64;
    this.stamp = dosDateTime(date);
    this.finished = false;
  }

  get size() {
    return this.offset;
  }

  has(path) {
    return this.names.has(normalizeZipPath(path).toLowerCase());
  }

  /**
   * Add a file.
   * @param {string} path  archive path (forward slashes)
   * @param {Blob|Uint8Array|string} data
   * @param {{crc?:number, compress?:boolean}} [options]  `crc` avoids re-reading a Blob
   */
  async add(path, data, { crc = null, compress = false } = {}) {
    if (this.finished) throw new Error('ZIP already finished');
    const name = normalizeZipPath(path);
    const lower = name.toLowerCase();
    if (this.names.has(lower)) throw new Error(`Duplicate archive path: ${name}`);
    this.names.add(lower);

    let payload = typeof data === 'string' ? encoder.encode(data) : data;
    let size;
    let method = 0;
    let compressedSize;
    if (payload instanceof Uint8Array) {
      size = payload.length;
      if (crc === null) crc = crc32(payload);
      if (compress && size > 64) {
        const deflated = await deflateRaw(payload);
        if (deflated && deflated.length < size) {
          payload = deflated;
          method = 8;
        }
      }
      compressedSize = payload.length;
    } else if (payload && typeof payload.size === 'number' && typeof payload.stream === 'function') {
      size = payload.size;
      if (crc === null) crc = await crc32OfBlob(payload);
      compressedSize = size;
    } else {
      throw new Error(`Unsupported data for ${name}`);
    }

    const nameBytes = encoder.encode(name);
    const zip64 = this.forceZip64 || size >= MAX32 || compressedSize >= MAX32;
    const extraLength = zip64 ? 20 : 0;
    const header = new Uint8Array(30 + nameBytes.length + extraLength);
    const view = new DataView(header.buffer);
    view.setUint32(0, 0x04034b50, true);
    view.setUint16(4, zip64 ? 45 : 20, true);
    view.setUint16(6, 0x0800, true); // UTF-8 names
    view.setUint16(8, method, true);
    view.setUint16(10, this.stamp.time, true);
    view.setUint16(12, this.stamp.day, true);
    view.setUint32(14, crc >>> 0, true);
    view.setUint32(18, zip64 ? MAX32 : compressedSize, true);
    view.setUint32(22, zip64 ? MAX32 : size, true);
    view.setUint16(26, nameBytes.length, true);
    view.setUint16(28, extraLength, true);
    header.set(nameBytes, 30);
    if (zip64) {
      const e = 30 + nameBytes.length;
      view.setUint16(e, 0x0001, true);
      view.setUint16(e + 2, 16, true);
      setUint64(view, e + 4, size);
      setUint64(view, e + 12, compressedSize);
    }

    this.entries.push({ nameBytes, crc: crc >>> 0, size, compressedSize, method, offset: this.offset });
    this.parts.push(header, payload);
    this.offset += header.length + compressedSize;
    return { path: name, size, crc };
  }

  /** Finish the archive and return it as a Blob. */
  finish() {
    if (this.finished) throw new Error('ZIP already finished');
    this.finished = true;
    const central = [];
    const cdOffset = this.offset;
    let cdSize = 0;
    let anyZip64 = false;
    for (const entry of this.entries) {
      const needSize = this.forceZip64 || entry.size >= MAX32 || entry.compressedSize >= MAX32;
      const needOffset = this.forceZip64 || entry.offset >= MAX32;
      const extraFields = (needSize ? 16 : 0) + (needOffset ? 8 : 0);
      const extraLength = extraFields ? 4 + extraFields : 0;
      const zip64 = extraFields > 0;
      anyZip64 = anyZip64 || zip64;
      const record = new Uint8Array(46 + entry.nameBytes.length + extraLength);
      const view = new DataView(record.buffer);
      view.setUint32(0, 0x02014b50, true);
      view.setUint16(4, (3 << 8) | (zip64 ? 45 : 20), true); // made by: Unix
      view.setUint16(6, zip64 ? 45 : 20, true);
      view.setUint16(8, 0x0800, true);
      view.setUint16(10, entry.method, true);
      view.setUint16(12, this.stamp.time, true);
      view.setUint16(14, this.stamp.day, true);
      view.setUint32(16, entry.crc, true);
      view.setUint32(20, needSize ? MAX32 : entry.compressedSize, true);
      view.setUint32(24, needSize ? MAX32 : entry.size, true);
      view.setUint16(28, entry.nameBytes.length, true);
      view.setUint16(30, extraLength, true);
      view.setUint16(32, 0, true); // comment
      view.setUint16(34, 0, true); // disk
      view.setUint16(36, 0, true); // internal attrs
      view.setUint32(38, (0o100644 << 16) >>> 0, true); // -rw-r--r--
      view.setUint32(42, needOffset ? MAX32 : entry.offset, true);
      record.set(entry.nameBytes, 46);
      if (extraLength) {
        let e = 46 + entry.nameBytes.length;
        view.setUint16(e, 0x0001, true);
        view.setUint16(e + 2, extraFields, true);
        e += 4;
        if (needSize) {
          setUint64(view, e, entry.size);
          setUint64(view, e + 8, entry.compressedSize);
          e += 16;
        }
        if (needOffset) setUint64(view, e, entry.offset);
      }
      central.push(record);
      cdSize += record.length;
    }

    const count = this.entries.length;
    const tail = [];
    const needZip64End = this.forceZip64 || anyZip64 || count >= MAX16 || cdOffset >= MAX32 || cdSize >= MAX32;
    if (needZip64End) {
      const zip64EndOffset = cdOffset + cdSize;
      const rec = new Uint8Array(56);
      const v = new DataView(rec.buffer);
      v.setUint32(0, 0x06064b50, true);
      setUint64(v, 4, 44);
      v.setUint16(12, (3 << 8) | 45, true);
      v.setUint16(14, 45, true);
      v.setUint32(16, 0, true);
      v.setUint32(20, 0, true);
      setUint64(v, 24, count);
      setUint64(v, 32, count);
      setUint64(v, 40, cdSize);
      setUint64(v, 48, cdOffset);
      const loc = new Uint8Array(20);
      const lv = new DataView(loc.buffer);
      lv.setUint32(0, 0x07064b50, true);
      lv.setUint32(4, 0, true);
      setUint64(lv, 8, zip64EndOffset);
      lv.setUint32(16, 1, true);
      tail.push(rec, loc);
    }
    const end = new Uint8Array(22);
    const ev = new DataView(end.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(4, 0, true);
    ev.setUint16(6, 0, true);
    ev.setUint16(8, needZip64End ? Math.min(count, MAX16) : count, true);
    ev.setUint16(10, needZip64End ? Math.min(count, MAX16) : count, true);
    ev.setUint32(12, needZip64End ? Math.min(cdSize, MAX32) : cdSize, true);
    ev.setUint32(16, needZip64End ? Math.min(cdOffset, MAX32) : cdOffset, true);
    ev.setUint16(20, 0, true);
    if (needZip64End && this.forceZip64) {
      // Point readers at the ZIP64 records.
      ev.setUint16(8, MAX16, true);
      ev.setUint16(10, MAX16, true);
      ev.setUint32(12, MAX32, true);
      ev.setUint32(16, MAX32, true);
    }
    tail.push(end);
    const blob = new Blob([...this.parts, ...central, ...tail], { type: 'application/zip' });
    this.parts = [];
    return blob;
  }
}
