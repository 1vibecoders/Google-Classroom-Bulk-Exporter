// CRX3 packing and verification (the format Chrome uses for packed
// extensions), implemented with Node's crypto so releases can be built
// without a browser.
//
// File layout:
//   "Cr24" | uint32le version (3) | uint32le header length | CrxFileHeader | ZIP
// CrxFileHeader (protobuf):
//   repeated AsymmetricKeyProof sha256_with_rsa = 2;   { bytes public_key = 1; bytes signature = 2; }
//   repeated AsymmetricKeyProof sha256_with_ecdsa = 3;
//   bytes signed_header_data = 10000;                   SignedData { bytes crx_id = 1; }
// The signature covers "CRX3 SignedData\0" | uint32le len(signed_header_data)
// | signed_header_data | ZIP, and crx_id is the first 16 bytes of
// SHA-256(public key in SubjectPublicKeyInfo DER), which is also what the
// extension ID ("a"–"p" letters) is derived from.
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify } from 'node:crypto';

const MAGIC = Buffer.from('Cr24');
const SIGNATURE_CONTEXT = Buffer.from('CRX3 SignedData\x00', 'binary');

// --- minimal protobuf ------------------------------------------------------

function varint(value) {
  const bytes = [];
  let v = value;
  while (v > 0x7f) {
    bytes.push((v & 0x7f) | 0x80);
    v = Math.floor(v / 128);
  }
  bytes.push(v);
  return Buffer.from(bytes);
}

function lengthDelimited(field, payload) {
  return Buffer.concat([varint(field * 8 + 2), varint(payload.length), payload]);
}

function readVarint(buf, pos) {
  let result = 0;
  let shift = 1;
  for (;;) {
    if (pos >= buf.length) throw new Error('Truncated protobuf varint');
    const byte = buf[pos++];
    result += (byte & 0x7f) * shift;
    if (!(byte & 0x80)) return [result, pos];
    shift *= 128;
  }
}

/** Parse a protobuf message into { field: [Buffer | number, ...] }. */
function parseMessage(buf) {
  const fields = {};
  let pos = 0;
  while (pos < buf.length) {
    let key;
    [key, pos] = readVarint(buf, pos);
    const field = Math.floor(key / 8);
    const wire = key % 8;
    let value;
    if (wire === 0) {
      [value, pos] = readVarint(buf, pos);
    } else if (wire === 2) {
      let len;
      [len, pos] = readVarint(buf, pos);
      if (pos + len > buf.length) throw new Error('Truncated protobuf field');
      value = buf.subarray(pos, pos + len);
      pos += len;
    } else {
      throw new Error(`Unsupported protobuf wire type ${wire}`);
    }
    (fields[field] = fields[field] || []).push(value);
  }
  return fields;
}

// --- keys and ids ----------------------------------------------------------

export function generatePrivateKeyPem() {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048, publicExponent: 0x10001 });
  return privateKey.export({ type: 'pkcs8', format: 'pem' });
}

/** SubjectPublicKeyInfo DER of the public half of a PEM private key (PKCS#1 or PKCS#8). */
export function publicKeyDer(privateKeyPem) {
  return createPublicKey(createPrivateKey(privateKeyPem)).export({ type: 'spki', format: 'der' });
}

export function crxIdBytes(spkiDer) {
  return createHash('sha256').update(spkiDer).digest().subarray(0, 16);
}

/** Chrome extension ID: the CRX id in hex, written with the letters a–p. */
export function extensionIdFromCrxId(idBytes) {
  return Buffer.from(idBytes)
    .toString('hex')
    .replace(/[0-9a-f]/g, (c) => String.fromCharCode(97 + parseInt(c, 16)));
}

export function extensionIdFromPrivateKey(privateKeyPem) {
  return extensionIdFromCrxId(crxIdBytes(publicKeyDer(privateKeyPem)));
}

function signedPayload(signedHeaderData, zip) {
  const size = Buffer.alloc(4);
  size.writeUInt32LE(signedHeaderData.length);
  return Buffer.concat([SIGNATURE_CONTEXT, size, signedHeaderData, zip]);
}

// --- pack / parse / verify -------------------------------------------------

/** Build a CRX3 file from an extension ZIP and an RSA private key (PEM). */
export function packCrx(zip, privateKeyPem) {
  const key = createPrivateKey(privateKeyPem);
  if (key.asymmetricKeyType !== 'rsa') throw new Error('The CRX signing key must be an RSA private key.');
  const spki = createPublicKey(key).export({ type: 'spki', format: 'der' });
  const signedHeaderData = lengthDelimited(1, crxIdBytes(spki));
  const signature = sign('sha256', signedPayload(signedHeaderData, zip), key);
  const proof = Buffer.concat([lengthDelimited(1, spki), lengthDelimited(2, signature)]);
  const header = Buffer.concat([lengthDelimited(2, proof), lengthDelimited(10000, signedHeaderData)]);
  const prefix = Buffer.alloc(12);
  MAGIC.copy(prefix, 0);
  prefix.writeUInt32LE(3, 4);
  prefix.writeUInt32LE(header.length, 8);
  return Buffer.concat([prefix, header, zip]);
}

/** Split a CRX3 file into its parts (no signature checks). */
export function parseCrx(crx) {
  const buf = Buffer.from(crx);
  if (buf.length < 12 || !buf.subarray(0, 4).equals(MAGIC)) throw new Error('Not a CRX file (missing "Cr24" magic).');
  const version = buf.readUInt32LE(4);
  if (version !== 3) throw new Error(`Unsupported CRX version ${version} (expected 3).`);
  const headerLength = buf.readUInt32LE(8);
  if (12 + headerLength > buf.length) throw new Error('Truncated CRX header.');
  const header = parseMessage(buf.subarray(12, 12 + headerLength));
  const proofs = (header[2] || []).map((p) => {
    const m = parseMessage(p);
    return { publicKey: m[1] && m[1][0], signature: m[2] && m[2][0] };
  });
  const signedHeaderData = header[10000] && header[10000][0];
  if (!signedHeaderData) throw new Error('CRX header has no signed data.');
  const crxId = parseMessage(signedHeaderData)[1];
  return {
    version,
    proofs,
    ecdsaProofs: (header[3] || []).length,
    signedHeaderData,
    crxId: crxId && crxId[0],
    zip: buf.subarray(12 + headerLength),
  };
}

/**
 * Verify a CRX3 file the way Chrome does: a valid RSA-SHA256 proof whose
 * public key hashes to the declared crx_id. Returns the extension ID.
 */
export function verifyCrx(crx) {
  const parsed = parseCrx(crx);
  if (!parsed.crxId || parsed.crxId.length !== 16) throw new Error('CRX signed data has no 16-byte crx_id.');
  const payload = signedPayload(parsed.signedHeaderData, parsed.zip);
  let developerKeyFound = false;
  for (const proof of parsed.proofs) {
    if (!proof.publicKey || !proof.signature) throw new Error('Incomplete key proof in CRX header.');
    const key = createPublicKey({ key: proof.publicKey, format: 'der', type: 'spki' });
    if (!verify('sha256', payload, key, proof.signature)) throw new Error('CRX signature does not verify.');
    if (crxIdBytes(proof.publicKey).equals(parsed.crxId)) developerKeyFound = true;
  }
  if (!developerKeyFound) throw new Error('No CRX key proof matches the crx_id.');
  return { extensionId: extensionIdFromCrxId(parsed.crxId), zip: parsed.zip, proofs: parsed.proofs.length };
}
