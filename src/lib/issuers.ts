// Display names and fixed colors per issuer. Color follows the issuer everywhere on the site,
// so a filter or a different asset never repaints Ondo as someone else.

const LABELS: Record<string, string> = {
  'Backed Assets': 'Backed · xStocks',
  'Ondo Assets': 'Ondo',
  'NA (Derivatives)': 'Perps (derivatives)',
  'Tether Holdings': 'Tether',
  'Dinari Assets': 'Dinari',
  'Hyperliquid Assets': 'Hyperliquid',
  'PreStocks Assets': 'PreStocks',
  'Tessera Assets': 'Tessera',
  'Kinesis Assets': 'Kinesis',
  'Superstate Assets': 'Superstate',
  'Fidelity Investments Assets': 'Fidelity',
  'Bitget Assets': 'Bitget',
  'Swarm Assets': 'Swarm',
};

export function issuerLabel(name: string): string {
  return LABELS[name] ?? name;
}

// Categorical slots in fixed order (see styles.css --series-N).
const SLOTS: Record<string, number> = {
  'Backed Assets': 1,
  'Ondo Assets': 2,
  bStocks: 3,
  Robinhood: 4,
  Reality: 5,
  'NA (Derivatives)': 6,
  'Tether Holdings': 7,
  Paxos: 8,
};

export function issuerColor(name: string): string {
  const slot = SLOTS[name];
  return slot ? `var(--series-${slot})` : 'var(--series-other)';
}
