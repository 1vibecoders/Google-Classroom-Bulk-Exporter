// A big send from the extension: course documents go to the server in requests
// of at most 40 (the server refuses more) and at most 3 MB of UTF-8, so the AI
// reads all of them; documents kept in the browser while signed out go to the
// server once the person is signed in.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { storeDocuments, uploadLocalDocuments } from '../../src/lib/documents/api';
import type { ReadDocument } from '../../src/lib/documents/fromExtension';

const local = vi.hoisted(() => ({ items: [] as ReadDocument[], removed: [] as string[] }));
vi.mock('../../src/lib/documents/local', () => ({
  localDocuments: async () => local.items,
  saveLocalDocuments: async (list: ReadDocument[]) => void local.items.push(...list),
  removeLocalDocuments: async (ids: string[]) => void local.removed.push(...ids),
}));

afterEach(() => {
  vi.unstubAllGlobals();
  local.items = [];
  local.removed = [];
});

function docs(count: number, text = 'Text'): ReadDocument[] {
  return Array.from({ length: count }, (_, i) => ({
    doc: { id: `file${i}`, classId: 'gc-class-MTEx', title: `Reading ${i}`, mime: 'application/pdf', status: 'ok', chars: text.length, via: 'extension' },
    text,
    parents: [],
  }));
}

function server(status: number) {
  const sizes: number[] = [];
  vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
    sizes.push((JSON.parse(String(init.body)) as { documents: unknown[] }).documents.length);
    return new Response(null, { status });
  });
  return sizes;
}

describe('storing course documents', () => {
  it('uploads a big send in requests of at most 40 documents', async () => {
    const sizes = server(204);
    expect(await storeDocuments(docs(95))).toBe('server');
    expect(sizes).toEqual([40, 40, 15]);
  });

  it('counts bytes, not characters: non-English text is split into smaller requests', async () => {
    const sizes = server(204);
    // 600,000 characters of 3 bytes each: 1.8 MB per document.
    expect(await storeDocuments(docs(3, '漢'.repeat(600_000)))).toBe('server');
    expect(sizes).toEqual([1, 1, 1]);
  });

  it('keeps documents in the browser when signed out, and uploads them once signed in', async () => {
    server(401);
    expect(await storeDocuments(docs(2))).toBe('browser');
    expect(local.items).toHaveLength(2);
    await uploadLocalDocuments();
    expect(local.removed).toEqual([]);
    const sizes = server(204);
    await uploadLocalDocuments();
    expect(sizes).toEqual([2]);
    expect(local.removed).toEqual(['file0', 'file1']);
  });
});
