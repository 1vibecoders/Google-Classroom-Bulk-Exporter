// One place that opens the create/edit dialogs, so any view can say
// `editors.open({ kind: 'assignment', id })` without owning modal state.
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import type { Assignment, AvailabilityWindow, ScheduleBlock, ScheduleEvent, SchoolClass } from '../model/types';
import { ClassEditor } from './ClassEditor';
import { AssignmentEditor } from './AssignmentEditor';
import { EventEditor } from './EventEditor';
import { AvailabilityEditor } from './AvailabilityEditor';
import { BlockEditor } from './BlockEditor';

export type EditorRequest =
  | { kind: 'class'; id?: string; initial?: Partial<SchoolClass> }
  | { kind: 'assignment'; id?: string; initial?: Partial<Assignment> }
  | { kind: 'event'; id?: string; initial?: Partial<ScheduleEvent> }
  | { kind: 'availability'; id?: string; initial?: Partial<AvailabilityWindow> }
  | { kind: 'block'; id?: string; initial?: Partial<ScheduleBlock> };

interface EditorsValue {
  open: (request: EditorRequest) => void;
  close: () => void;
}

const EditorsContext = createContext<EditorsValue | null>(null);

export function EditorProvider({ children }: { children: ReactNode }) {
  const [request, setRequest] = useState<EditorRequest | null>(null);
  const close = useCallback(() => setRequest(null), []);
  const open = useCallback((next: EditorRequest) => setRequest(next), []);
  const value = useMemo(() => ({ open, close }), [open, close]);

  let editor: ReactNode = null;
  if (request) {
    // `key` resets the form when another item is opened while one is open.
    const key = `${request.kind}:${request.id ?? 'new'}`;
    switch (request.kind) {
      case 'class':
        editor = <ClassEditor key={key} id={request.id} initial={request.initial} onClose={close} />;
        break;
      case 'assignment':
        editor = <AssignmentEditor key={key} id={request.id} initial={request.initial} onClose={close} />;
        break;
      case 'event':
        editor = <EventEditor key={key} id={request.id} initial={request.initial} onClose={close} />;
        break;
      case 'availability':
        editor = <AvailabilityEditor key={key} id={request.id} initial={request.initial} onClose={close} />;
        break;
      case 'block':
        editor = <BlockEditor key={key} id={request.id} initial={request.initial} onClose={close} />;
        break;
    }
  }

  return (
    <EditorsContext.Provider value={value}>
      {children}
      {editor}
    </EditorsContext.Provider>
  );
}

export function useEditors(): EditorsValue {
  const value = useContext(EditorsContext);
  if (!value) throw new Error('useEditors must be used inside <EditorProvider>');
  return value;
}

/** Props every editor dialog receives. Without `id` it creates a new item. */
export interface EditorProps<T> {
  id?: string;
  initial?: Partial<T>;
  onClose: () => void;
}
