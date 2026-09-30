const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });

export function usd(n: number | null | undefined): string {
  if (n == null) return '—';
  return `$${compact.format(n)}`;
}

export function price(n: number | null | undefined): string {
  if (n == null) return '—';
  if (n >= 1) return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return `$${n.toPrecision(4)}`;
}

/** Signed basis points: "+21.8 bps", "−9.8 bps". */
export function bps(n: number | null | undefined, digits = 1): string {
  if (n == null) return '—';
  const abs = Math.abs(n);
  const body = abs >= 1000 ? Math.round(abs).toLocaleString('en-US') : abs.toFixed(digits);
  return `${n > 0 ? '+' : n < 0 ? '−' : ''}${body} bps`;
}

export function pct(n: number | null | undefined, digits = 0): string {
  if (n == null) return '—';
  return `${(n * 100).toFixed(digits)}%`;
}

export function int(n: number): string {
  return n.toLocaleString('en-US');
}

export function ago(iso: string): string {
  const mins = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.round(hours / 24)} days ago`;
}

export function utc(iso: string): string {
  return new Date(iso).toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
}

/** CMC descriptions can be long markdown FAQs; keep the first couple of plain sentences. */
export function shortDescription(md: string, maxChars = 320): string {
  const text = md
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/#+\s*/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const sentences = (text.match(/[^.!?]+[.!?]+/g) ?? [text]).map((x) => x.trim()).filter((x) => !x.endsWith('?'));
  let out = '';
  for (const sentence of sentences) {
    if (out && (out + ' ' + sentence).length > maxChars) break;
    out = out ? `${out} ${sentence}` : sentence;
    if (out.length > maxChars * 0.6) break;
  }
  return out.length > maxChars ? `${out.slice(0, maxChars - 1)}…` : out;
}
