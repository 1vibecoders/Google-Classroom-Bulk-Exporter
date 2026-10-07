// CRC-32 (IEEE 802.3), as required by the ZIP format. Incremental so large
// downloads can be checksummed while they stream in.

const TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/** Continue a CRC with more bytes. Start with crc = 0. */
export function crc32Update(crc, bytes) {
  let c = (crc ^ 0xffffffff) >>> 0;
  for (let i = 0; i < bytes.length; i++) c = TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function crc32(bytes) {
  return crc32Update(0, bytes);
}

/** CRC of a Blob, read as a stream so memory stays bounded. */
export async function crc32OfBlob(blob) {
  let crc = 0;
  const reader = blob.stream().getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    crc = crc32Update(crc, value);
  }
  return crc;
}
