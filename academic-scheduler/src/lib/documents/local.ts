// Course documents kept in this browser (IndexedDB) when nobody is signed in
// to the online version: documents can be far larger than the schedule's
// localStorage space. Cleared with the browser's site data.
import type { ReadDocument } from './fromExtension';

const NAME = 'academic-scheduler-documents';
const STORE = 'documents';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: 'doc.id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function run<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  const db = await open();
  try {
    return await new Promise<T | undefined>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const request = work(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(request ? request.result : undefined);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export async function saveLocalDocuments(list: ReadDocument[]): Promise<void> {
  await run('readwrite', (store) => {
    for (const item of list) store.put(item);
  });
}

export async function removeLocalDocuments(ids: string[]): Promise<void> {
  await run('readwrite', (store) => {
    for (const id of ids) store.delete(id);
  });
}

/** Everything stored here; empty when IndexedDB is unavailable. */
export async function localDocuments(): Promise<ReadDocument[]> {
  try {
    return (await run<ReadDocument[]>('readonly', (store) => store.getAll() as IDBRequest<ReadDocument[]>)) ?? [];
  } catch {
    return [];
  }
}
