// A big send from the extension: course documents go to the server in requests
// of at most 40 (the server refuses more), so the AI reads all of them.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { storeDocuments } from '../../src/lib/documents/api';
import type { ReadDocument } from '../../src/lib/documents/fromExtension';

afterEach(() => vi.unstubAllGlobals());

describe('storing course documents', () => {
  it('uploads a big send in requests of at most 40 documents', async () => {
    const sizes: number[] = [];
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      sizes.push((JSON.parse(String(init.body)) as { documents: unknown[] }).documents.length);
      return new Response(null, { status: 204 });
    });
    const list: ReadDocument[] = Array.from({ length: 95 }, (_, i) => ({
      doc: { id: `file${i}`, classId: 'gc-class-MTEx', title: `Reading ${i}`, mime: 'application/pdf', status: 'ok', chars: 4, via: 'extension' },
      text: 'Text',
      parents: [],
    }));
    expect(await storeDocuments(list)).toBe('server');
    expect(sizes).toEqual([40, 40, 15]);
  });
});
