// Course document routes (deployed by api/documents.ts).
//   GET  /api/documents          the signed-in person's documents, without text
//   GET  /api/documents?id=<id>  one document's text
//   POST /api/documents          documents the browser extension sent, read by the website
//                                { documents: [{ id, classId, title, url?, mime, status, text?, parents }] }
// Documents read from Drive by the sync are not replaced by extension copies.
import { MAX_DOCUMENT_CHARS } from '../src/lib/documents/text.js';
import type { CourseDocument } from '../src/model/courseDocument.js';
import { sha256 } from './crypto.js';
import { error, isSameOrigin, json, sessionUser, withContext } from './http.js';

const MAX_UPLOAD = 40;
const DRIVE_ID = /^[A-Za-z0-9_-]{1,200}$/;
const CLASS_ID = /^gc-class-([A-Za-z0-9._:-]{1,90})$/;
const SOURCE_ID = /^[A-Za-z0-9._:-]{1,90}$/;
const STATUSES = new Set(['ok', 'unsupported', 'too_large', 'no_text', 'unreadable', 'inaccessible']);
const PARENT_KINDS = new Set(['coursework', 'material', 'announcement']);

type Row = { source_id: string; course_id: string; data: Record<string, unknown> };

const str = (v: unknown) => (typeof v === 'string' ? v : undefined);

export function getDocuments(request: Request): Promise<Response> {
  return withContext(async (context) => {
    const user = await sessionUser(context, request);
    if (!user) return error(401, 'signed_out', 'Sign in with Google first.');
    const id = new URL(request.url).searchParams.get('id');
    if (id !== null) {
      const rows = await context.db.query<{ text: string | null }>(
        `SELECT data->>'text' AS text FROM source_records WHERE user_id = $1 AND kind = 'document' AND source_id = $2`,
        [user.id, id.slice(0, 200)],
      );
      if (!rows[0]) return error(404, 'not_found', 'This document is not stored.');
      return json({ text: rows[0].text ?? '' }, 200, { 'cache-control': 'no-store' });
    }
    const rows = await context.db.query<Row>(
      `SELECT source_id, course_id, data - 'text' || jsonb_build_object('chars', coalesce(length(data->>'text'), 0)) AS data
       FROM source_records WHERE user_id = $1 AND kind = 'document' AND state = 'present' ORDER BY data->>'title'`,
      [user.id],
    );
    const documents: CourseDocument[] = rows.map((r) => ({
      id: r.source_id,
      classId: `gc-class-${r.course_id}`,
      title: str(r.data.title) ?? 'Document',
      ...(str(r.data.url) ? { url: str(r.data.url) } : {}),
      mime: str(r.data.mime) ?? 'unknown',
      status: (str(r.data.status) ?? 'unreadable') as CourseDocument['status'],
      chars: Number(r.data.chars) || 0,
      via: r.data.via === 'extension' ? 'extension' : 'drive',
    }));
    return json({ documents }, 200, { 'cache-control': 'no-store' });
  });
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

/** One uploaded document as a knowledge-base record, or null when anything is off. */
export function uploadedRecord(v: unknown) {
  if (!isObj(v) || typeof v.id !== 'string' || !DRIVE_ID.test(v.id) || typeof v.classId !== 'string') return null;
  const course = CLASS_ID.exec(v.classId);
  if (!course || typeof v.status !== 'string' || !STATUSES.has(v.status) || typeof v.mime !== 'string' || v.mime.length > 200) return null;
  const text = v.status === 'ok' ? v.text : undefined;
  if (v.status === 'ok' && (typeof text !== 'string' || !text.trim() || text.length > MAX_DOCUMENT_CHARS)) return null;
  const parents = Array.isArray(v.parents) ? v.parents.slice(0, 20) : [];
  if (!parents.every((p) => isObj(p) && PARENT_KINDS.has(String(p.kind)) && typeof p.sourceId === 'string' && SOURCE_ID.test(p.sourceId))) return null;
  const data = {
    title: typeof v.title === 'string' && v.title.trim() ? Array.from(v.title.trim()).slice(0, 300).join('') : 'Document',
    ...(typeof v.url === 'string' && /^https:\/\/[^\s]{1,1990}$/.test(v.url) ? { url: v.url } : {}),
    mime: v.mime,
    status: v.status,
    ...(text ? { text } : {}),
    parents: parents.map((p) => ({ kind: (p as Obj).kind, sourceId: (p as Obj).sourceId })),
    via: 'extension',
  };
  return { kind: 'document', source_id: v.id, course_id: course[1], fingerprint: sha256(String(text ?? v.status)), data, state: 'present' };
}

export function postDocuments(request: Request): Promise<Response> {
  if (!isSameOrigin(request)) return Promise.resolve(error(403, 'cross_origin', 'Request refused.'));
  return withContext(async (context) => {
    const user = await sessionUser(context, request);
    if (!user) return error(401, 'signed_out', 'Sign in with Google first.');
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      body = null;
    }
    const list = isObj(body) && Array.isArray(body.documents) ? body.documents : null;
    if (!list || list.length === 0 || list.length > MAX_UPLOAD) return error(400, 'bad_request', `Send between 1 and ${MAX_UPLOAD} documents.`);
    const records = list.map(uploadedRecord);
    if (records.some((r) => r === null)) return error(400, 'bad_document', 'A document could not be read.');
    await context.db.query(
      `INSERT INTO source_records (user_id, kind, source_id, course_id, fingerprint, data, state)
       SELECT $1, r.kind, r.source_id, r.course_id, r.fingerprint, r.data, r.state
       FROM jsonb_to_recordset($2::jsonb) AS r(kind text, source_id text, course_id text, fingerprint text, data jsonb, state text)
       ON CONFLICT (user_id, kind, source_id) DO UPDATE SET
         course_id = EXCLUDED.course_id, data = EXCLUDED.data, state = EXCLUDED.state, last_seen = now(),
         changed_at = CASE WHEN source_records.fingerprint <> EXCLUDED.fingerprint THEN now() ELSE source_records.changed_at END,
         fingerprint = EXCLUDED.fingerprint
       WHERE source_records.data->>'via' IS DISTINCT FROM 'drive'`,
      [user.id, JSON.stringify(records)],
    );
    return new Response(null, { status: 204 });
  });
}
