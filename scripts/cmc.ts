// Minimal CoinMarketCap Pro API client for the snapshot scripts.
// Logs every call (credits, latency, status) and writes a key-free evidence file per endpoint.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ApiCall } from '../src/lib/types.ts';

const BASE_URL = 'https://pro-api.coinmarketcap.com';
// Basic tier allows 30 calls/minute; stay under it so the same script works after the event.
const MIN_INTERVAL_MS = 2100;

interface CmcStatus {
  timestamp: string;
  error_code: number | string;
  error_message: string | null;
  elapsed: number;
  credit_count: number;
}

export class CmcError extends Error {
  readonly code: number;
  constructor(code: number, message: string) {
    super(message);
    this.code = code;
  }
}

type Params = Record<string, string | number | boolean | undefined>;

export interface CmcClient {
  get<T>(endpoint: string, params?: Params, evidenceName?: string): Promise<T>;
  calls: ApiCall[];
  creditsUsed(): number;
}

export function createClient(apiKey: string, evidenceDir?: string): CmcClient {
  const calls: ApiCall[] = [];
  let lastCallAt = 0;
  if (evidenceDir) mkdirSync(evidenceDir, { recursive: true });

  async function get<T>(endpoint: string, params: Params = {}, evidenceName?: string): Promise<T> {
    const query = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v !== undefined) query.set(k, String(v));
    const url = `${BASE_URL}${endpoint}${query.size ? `?${query}` : ''}`;

    for (let attempt = 0; ; attempt++) {
      const wait = lastCallAt + MIN_INTERVAL_MS - Date.now();
      if (wait > 0) await sleep(wait);
      lastCallAt = Date.now();

      const res = await fetch(url, {
        headers: { 'X-CMC_PRO_API_KEY': apiKey, Accept: 'application/json' },
      });
      const body = (await res.json()) as { status: CmcStatus; data?: T };
      const status = body.status;
      const code = Number(status?.error_code ?? res.status);

      if (res.status === 429 && attempt < 3) {
        await sleep(15_000 * (attempt + 1));
        continue;
      }

      calls.push({
        endpoint,
        query: query.toString(),
        credits: status?.credit_count ?? 0,
        errorCode: code,
        errorMessage: status?.error_message || null,
        elapsedMs: status?.elapsed ?? 0,
        at: status?.timestamp ?? new Date().toISOString(),
      });

      if (evidenceDir && evidenceName) writeEvidence(evidenceDir, evidenceName, url, body);
      if (code !== 0 || body.data === undefined) {
        throw new CmcError(code, `${endpoint}: ${status?.error_message ?? res.statusText}`);
      }
      return body.data;
    }
  }

  return {
    get,
    calls,
    creditsUsed: () => calls.reduce((sum, c) => sum + c.credits, 0),
  };
}

// Evidence = the exact request (key redacted) plus the status block and a trimmed sample of the
// response, so reviewers can see real calls without the repo carrying megabytes of JSON.
function writeEvidence(dir: string, name: string, url: string, body: unknown) {
  const file = join(dir, `${name}.json`);
  const evidence = {
    request: `GET ${url}`,
    headers: { 'X-CMC_PRO_API_KEY': '<redacted>' },
    response: trim(body, 0),
  };
  writeFileSync(file, JSON.stringify(evidence, null, 2) + '\n');
}

function trim(value: unknown, depth: number): unknown {
  if (Array.isArray(value)) {
    const head = value.slice(0, 2).map((v) => trim(v, depth + 1));
    return value.length > 2 ? [...head, `… ${value.length - 2} more`] : head;
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, trim(v, depth + 1)]));
  }
  return value;
}

export function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function requireKey(): string {
  const key = process.env.CMC_API_KEY;
  if (!key || key === 'paste-your-key-here') {
    console.error('Set CMC_API_KEY in .env (see .env.example).');
    process.exit(1);
  }
  return key;
}

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
