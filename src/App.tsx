import { useMemo, useState } from 'react';
import { useHashRoute, useSnapshot } from './lib/data.ts';
import { ago, utc } from './lib/format.ts';
import { analyzeAsset } from './lib/parity.ts';
import { AssetPage } from './views/AssetPage.tsx';
import { Issuers } from './views/Issuers.tsx';
import { Method } from './views/Method.tsx';
import { Radar } from './views/Radar.tsx';

const NAV = [
  { href: '#/', key: '', label: 'Radar' },
  { href: '#/asset/spy', key: 'asset', label: 'Best way to buy' },
  { href: '#/issuers', key: 'issuers', label: 'Issuers' },
  { href: '#/method', key: 'method', label: 'Method & API' },
];

export function App() {
  const { data, error } = useSnapshot();
  const route = useHashRoute();
  const views = useMemo(() => data?.snapshot.assets.map(analyzeAsset) ?? [], [data]);
  const [theme, setTheme] = useState<'light' | 'dark' | null>(null);

  const toggleTheme = () => {
    const current =
      theme ?? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    const next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    setTheme(next);
  };

  let page = <div className="loading">{error ? `Couldn't load data: ${error}` : 'Loading snapshot…'}</div>;
  if (data) {
    const { snapshot, summary } = data;
    if (route[0] === 'asset') page = <AssetPage slug={route[1] ?? 'spy'} views={views} snapshot={snapshot} summary={summary} />;
    else if (route[0] === 'issuers') page = <Issuers views={views} snapshot={snapshot} summary={summary} />;
    else if (route[0] === 'method') page = <Method snapshot={snapshot} views={views} />;
    else page = <Radar views={views} snapshot={snapshot} summary={summary} />;
  }

  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <a className="brand" href="#/">
            <span className="brand-mark">
              <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
                <path d="M2 5.5h12M2 10.5h12" stroke="white" strokeWidth="2.2" strokeLinecap="round" />
              </svg>
            </span>
            Parity
          </a>
          <nav className="nav">
            {NAV.map((n) => (
              <a key={n.key} href={n.href} className={(route[0] ?? '') === n.key ? 'active' : ''}>
                {n.label}
              </a>
            ))}
          </nav>
          {data && (
            <span className="fresh" title={`Snapshot ${utc(data.snapshot.generatedAt)}`}>
              <span className="dot" /> <span className="long">CMC data</span> {ago(data.snapshot.generatedAt)}
            </span>
          )}
          <button className="theme-toggle" onClick={toggleTheme} aria-label="Toggle dark mode">
            ◐
          </button>
        </div>
      </header>
      <main className="shell">
        {page}
        <footer className="footer">
          <span>
            Built on the <a href="https://coinmarketcap.com/api/documentation/pro-api-reference/real-world-assets">CoinMarketCap v5 RWA API</a> for #BuildwithCMC.
            Price map, not investment advice: wrappers differ in rights, chains and redemption.
          </span>
          {data && <span>Snapshot {utc(data.snapshot.generatedAt)}</span>}
        </footer>
      </main>
    </>
  );
}
