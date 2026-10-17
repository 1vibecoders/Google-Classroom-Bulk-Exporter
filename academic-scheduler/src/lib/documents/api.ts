// Course documents: on this website's server (server/documentRoutes.ts) for a
// signed-in person, where the AI analysis reads them too; otherwise in this
// browser (local.ts). Without a backend or signed out, the server part is
// empty and nothing else changes. Documents kept in the browser go to the
// server before the next AI run once the person is signed in (uploadLocalDocuments).
import type { CourseDocument } from '../../model/courseDocument';
import type { ReadDocument } from './fromExtension';
import { localDocuments, removeLocalDocuments, saveLocalDocuments } from './local';

/** Vercel Functions accept request bodies up to 4.5 MB (bytes, not characters); the server takes at most 40 documents per request (documentRoutes.ts). */
const MAX_UPLOAD_BYTES = 3_000_000;
const MAX_UPLOAD_COUNT = 40;
const encoder = new TextEncoder();

async function get(path: string): Promise<Record<string, unknown> | null> {
  try {
    const response = await fetch(path, { credentials: 'same-origin', headers: { accept: 'application/json' } });
    if (!response.ok || !(response.headers.get('content-type') ?? '').includes('application/json')) return null;
    return (await response.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export async function listDocuments(): Promise<CourseDocument[]> {
  const [body, local] = await Promise.all([get('/api/documents'), localDocuments()]);
  const server = Array.isArray(body?.documents) ? (body.documents as CourseDocument[]) : [];
  const onServer = new Set(server.map((d) => d.id));
  return [...server, ...local.map((l) => l.doc).filter((d) => !onServer.has(d.id))];
}

export async function fetchDocumentText(id: string): Promise<string | null> {
  const local = (await localDocuments()).find((l) => l.doc.id === id);
  if (local) return local.text ?? '';
  const body = await get(`/api/documents?id=${encodeURIComponent(id)}`);
  return typeof body?.text === 'string' ? body.text : null;
}

async function upload(list: ReadDocument[]): Promise<boolean> {
  try {
    const documents = list.map((l) => ({ ...l.doc, text: l.text, parents: l.parents }));
    const response = await fetch('/api/documents', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ documents }),
    });
    return response.status === 204;
  } catch {
    return false;
  }
}

/** Uploads in requests of bounded size (UTF-8 bytes); stops at the first refusal (signed out, no backend). Returns the documents uploaded. */
async function uploadAll(list: ReadDocument[]): Promise<ReadDocument[]> {
  const batches: ReadDocument[][] = [[]];
  let bytes = 0;
  for (const item of list) {
    const size = encoder.encode(JSON.stringify(item)).length + 200;
    const current = batches[batches.length - 1];
    if ((bytes + size > MAX_UPLOAD_BYTES && current.length) || current.length >= MAX_UPLOAD_COUNT) {
      batches.push([]);
      bytes = 0;
    }
    batches[batches.length - 1].push(item);
    bytes += size;
  }
  const done: ReadDocument[] = [];
  for (const batch of batches) {
    if (!(await upload(batch))) break;
    done.push(...batch);
  }
  return done;
}

/** Stores documents on the server when signed in (so the AI reads them), otherwise in this browser. */
export async function storeDocuments(list: ReadDocument[]): Promise<'server' | 'browser' | 'failed'> {
  if (!list.length) return 'server';
  const done = await uploadAll(list);
  if (done.length === list.length) return 'server';
  try {
    await saveLocalDocuments(list.slice(done.length));
    return 'browser';
  } catch {
    return 'failed';
  }
}

/** Moves documents kept in this browser to the server (signed in), so the AI reads them; does nothing when signed out. */
export async function uploadLocalDocuments(): Promise<void> {
  const local = await localDocuments();
  if (!local.length) return;
  const done = await uploadAll(local);
  if (done.length) await removeLocalDocuments(done.map((d) => d.doc.id)).catch(() => undefined);
}
