// The AI analysis status shown across the website (Review page, navigation
// count, Settings card), kept in memory for this tab and refreshed from the
// server. The automation preference is per browser (localStorage).
import { useSyncExternalStore } from 'react';
import type { AnalysisStatus } from '../model/aiProposal';
import { getAnalysis } from '../lib/ai/api';

let status: AnalysisStatus | null = null;
const listeners = new Set<() => void>();

export function getAiStatus(): AnalysisStatus | null {
  return status;
}

export function setAiStatus(value: AnalysisStatus | null): void {
  status = value;
  for (const listener of listeners) listener();
}

/** Drop proposals that were decided in this tab (the server already knows). */
export function forgetProposals(keys: string[]): void {
  if (!status) return;
  setAiStatus({ ...status, proposals: status.proposals.filter((p) => !keys.includes(p.key)) });
}

export async function refreshAiStatus(): Promise<void> {
  setAiStatus(await getAnalysis());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useAiStatus(): AnalysisStatus | null {
  return useSyncExternalStore(subscribe, getAiStatus);
}

const AUTO_KEY = 'academic-scheduler:ai-auto-apply';

/** Apply safe, high-confidence proposals without asking (default on; § 17.3). */
export function getAutoApply(): boolean {
  try {
    return window.localStorage.getItem(AUTO_KEY) !== 'off';
  } catch {
    return true;
  }
}

export function setAutoApply(on: boolean): void {
  try {
    window.localStorage.setItem(AUTO_KEY, on ? 'on' : 'off');
  } catch {
    // private window: the default stays
  }
}
