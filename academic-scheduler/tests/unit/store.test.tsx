// @vitest-environment jsdom
// The store saves changes to localStorage after a short debounce; a change
// made just before the page is hidden, reloaded or closed must still be saved.
import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { StoreProvider, useStore } from '../../src/state/store';
import { STORAGE_KEY } from '../../src/state/persistence';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
let dispatchRef: ReturnType<typeof useStore>['dispatch'] | null = null;

function Grab() {
  const { dispatch } = useStore();
  useEffect(() => {
    dispatchRef = dispatch;
  }, [dispatch]);
  return null;
}

function saved(): { doc: { settings?: { breakMinutes?: number } } } | null {
  const raw = localStorage.getItem(STORAGE_KEY);
  return raw ? JSON.parse(raw) : null;
}

beforeEach(() => {
  localStorage.clear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(<StoreProvider><Grab /></StoreProvider>));
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  dispatchRef = null;
});

describe('store persistence', () => {
  it('saves after the debounce', async () => {
    act(() => dispatchRef!({ type: 'updateSettings', settings: { breakMinutes: 15 } }));
    expect(saved()).toBeNull();
    await act(() => new Promise((resolve) => setTimeout(resolve, 300)));
    expect(saved()?.doc.settings?.breakMinutes).toBe(15);
  });

  it('saves a pending change immediately on pagehide', () => {
    act(() => dispatchRef!({ type: 'updateSettings', settings: { breakMinutes: 20 } }));
    expect(saved()).toBeNull();
    window.dispatchEvent(new Event('pagehide'));
    expect(saved()?.doc.settings?.breakMinutes).toBe(20);
  });

  it('saves a pending change when the store unmounts', () => {
    act(() => dispatchRef!({ type: 'updateSettings', settings: { breakMinutes: 25 } }));
    act(() => root.unmount());
    expect(saved()?.doc.settings?.breakMinutes).toBe(25);
    // afterEach unmounts again; give it a fresh root.
    root = createRoot(container);
  });
});
