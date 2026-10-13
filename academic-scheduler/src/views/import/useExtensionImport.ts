// Receives class scans from the browser extension (lib/sync/extensionScan.ts):
// the extension injects a script into this tab that posts them here with
// window.postMessage until it gets a receipt. Only messages from this page's
// own window and origin are read; the data is validated and opens the import
// preview like any other import, so nothing changes until the person imports.
// Course documents sent along are read into text and stored (on the server when
// signed in, so the AI reads them; otherwise in this browser).
import { useEffect, useRef } from 'react';
import { storeDocuments } from '../../lib/documents/api';
import { readDocuments, type ExtensionDocument } from '../../lib/documents/fromExtension';
import { EXTENSION_FILE_NAME, EXTENSION_PROTOCOL, EXTENSION_PROTOCOL_VERSION, readExtensionMessage, scansToBatch } from '../../lib/sync/extensionScan';
import { nowLocal } from '../../lib/time';
import { useStore } from '../../state/store';
import { openBatchPreview } from './fromBatch';

async function keepDocuments(docs: ExtensionDocument[], notify: ReturnType<typeof useStore>['notify']): Promise<void> {
  const read = await readDocuments(docs);
  const where = await storeDocuments(read);
  const withText = read.filter((r) => r.doc.status === 'ok').length;
  if (where === 'failed') notify('The course documents from the extension could not be stored in this browser.', { tone: 'warning' });
  else
    notify(
      `Read ${withText} of ${read.length} course ${read.length === 1 ? 'document' : 'documents'} from the extension${where === 'browser' ? ' (kept in this browser)' : ''}. They are listed on the Classes page.`,
      { tone: 'success' },
    );
}

export function useExtensionImport(): void {
  const { state, notify } = useStore();
  const latest = useRef({ doc: state.doc, notify });
  latest.current = { doc: state.doc, notify };

  useEffect(() => {
    // The extension repeats its message until it is answered: answer repeats the same way, but import once.
    const answered = new Map<string, { ok: boolean; message?: string }>();
    const onMessage = (event: MessageEvent) => {
      if (event.source !== window || event.origin !== window.location.origin) return;
      const message = readExtensionMessage(event.data);
      if (!message) return;
      let answer = answered.get(message.id);
      if (!answer) {
        if ('error' in message) answer = { ok: false, message: message.error };
        else {
          const batch = scansToBatch(message.scans, Intl.DateTimeFormat().resolvedOptions().timeZone, nowLocal());
          const classes = message.scans.length === 1 ? `“${message.scans[0].classInfo.name}”` : `${message.scans.length} classes`;
          const failed = openBatchPreview(latest.current.doc, batch, message.scans.length === 1 ? `${EXTENSION_FILE_NAME}: ${message.scans[0].classInfo.name}` : EXTENSION_FILE_NAME);
          answer = failed ? { ok: false, message: failed } : { ok: true };
          if (failed) latest.current.notify(`The extension’s scan could not be used: ${failed}`, { tone: 'error' });
          else {
            latest.current.notify(`Received ${classes} from the browser extension. Review the changes before importing.`, { tone: 'success' });
            if (message.documents.length) void keepDocuments(message.documents, latest.current.notify);
          }
        }
        answered.set(message.id, answer);
      }
      window.postMessage({ protocol: EXTENSION_PROTOCOL, version: EXTENSION_PROTOCOL_VERSION, type: 'received', id: message.id, ...answer }, window.location.origin);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);
}
