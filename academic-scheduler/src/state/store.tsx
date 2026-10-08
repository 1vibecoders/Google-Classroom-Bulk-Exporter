// React binding for the reducer: provides state + dispatch, saves every change
// to localStorage (debounced), keeps several open tabs in sync, and exposes a
// small toast/notification channel used across the app.
import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from 'react';
import { reducer, initialState, type Action, type AppState } from './reducer';
import { loadState, saveState, STORAGE_KEY } from './persistence';

export interface Toast {
  id: number;
  message: string;
  tone?: 'info' | 'success' | 'warning' | 'error';
  action?: { label: string; run: () => void };
}

interface StoreValue {
  state: AppState;
  dispatch: (action: Action) => void;
  toasts: Toast[];
  notify: (message: string, options?: Omit<Toast, 'id' | 'message'>) => void;
  dismiss: (id: number) => void;
  storageProblem: string | null;
}

const StoreContext = createContext<StoreValue | null>(null);

export function StoreProvider({ children, initial }: { children: ReactNode; initial?: AppState }) {
  const loaded = useMemo(() => (initial ? { state: initial, problem: null } : loadState()), [initial]);
  const [state, dispatch] = useReducer(reducer, loaded.state ?? initialState());
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [storageProblem, setStorageProblem] = useState<string | null>(loaded.problem);
  const nextToast = useRef(1);
  const skipSave = useRef(true);
  /** A change that is not saved yet (waiting for the debounce). */
  const unsaved = useRef<AppState | null>(null);

  // Persist (debounced).
  useEffect(() => {
    if (skipSave.current) {
      skipSave.current = false;
      return;
    }
    unsaved.current = state;
    const timer = setTimeout(() => {
      unsaved.current = null;
      const problem = saveState(state);
      setStorageProblem(problem);
    }, 250);
    return () => clearTimeout(timer);
  }, [state]);

  // Save a pending change right away when the page is hidden, reloaded or
  // closed, so a change made just before leaving is never lost.
  useEffect(() => {
    const flush = () => {
      const pending = unsaved.current;
      if (!pending) return;
      unsaved.current = null;
      setStorageProblem(saveState(pending));
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    window.addEventListener('pagehide', flush);
    window.addEventListener('beforeunload', flush);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('pagehide', flush);
      window.removeEventListener('beforeunload', flush);
      document.removeEventListener('visibilitychange', onVisibility);
      flush();
    };
  }, []);

  // Another tab changed the schedule: load it.
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== STORAGE_KEY || event.newValue === null) return;
      const result = loadState();
      if (!result.problem) {
        skipSave.current = true;
        unsaved.current = null;
        dispatch({ type: 'loadState', state: result.state });
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const dismiss = useCallback((id: number) => setToasts((list) => list.filter((t) => t.id !== id)), []);
  const notify = useCallback(
    (message: string, options: Omit<Toast, 'id' | 'message'> = {}) => {
      const id = nextToast.current++;
      setToasts((list) => [...list.slice(-3), { id, message, ...options }]);
      setTimeout(() => dismiss(id), options.action ? 9000 : 5000);
    },
    [dismiss],
  );

  const value = useMemo(() => ({ state, dispatch, toasts, notify, dismiss, storageProblem }), [state, toasts, notify, dismiss, storageProblem]);
  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): StoreValue {
  const value = useContext(StoreContext);
  if (!value) throw new Error('useStore must be used inside <StoreProvider>');
  return value;
}

/** Shorthand for the current schedule document. */
export function useDoc() {
  return useStore().state.doc;
}
