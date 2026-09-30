import { useEffect, useState } from 'react';
import type { AssetHistory, HistorySummary, Snapshot } from './types.ts';

// Relative URLs so the static build works under any base path (e.g. GitHub Pages /<repo>/).
async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(path, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return res.json() as Promise<T>;
}

export function useSnapshot() {
  const [data, setData] = useState<{ snapshot: Snapshot; summary: HistorySummary | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    Promise.all([
      getJson<Snapshot>('data/snapshot.json'),
      getJson<HistorySummary>('data/history/summary.json').catch(() => null),
    ])
      .then(([snapshot, summary]) => setData({ snapshot, summary }))
      .catch((e: Error) => setError(e.message));
  }, []);
  return { data, error };
}

export function useHistory(rwaId: number | null) {
  const [history, setHistory] = useState<AssetHistory | null>(null);
  useEffect(() => {
    setHistory(null);
    if (rwaId == null) return;
    let live = true;
    getJson<AssetHistory>(`data/history/${rwaId}.json`)
      .then((h) => live && setHistory(h))
      .catch(() => live && setHistory(null));
    return () => {
      live = false;
    };
  }, [rwaId]);
  return history;
}

export function useHashRoute(): string[] {
  const read = () => window.location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  const [route, setRoute] = useState(read);
  useEffect(() => {
    const on = () => {
      setRoute(read());
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}
