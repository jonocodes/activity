// Recording and replaying real API exchanges, for the recorded fixtures (`just record-fixtures`).
import { gunzipSync, gzipSync } from 'node:zlib';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { HttpRequest, HttpResponse, Transport } from './client.ts';

export interface Exchange { request: { method: string; url: string; body?: string }; response: HttpResponse }
export interface Recording { owner: string; recordedAt: string; exchanges: Exchange[] }

const KEEP_HEADERS = ['retry-after', 'x-ratelimit-remaining', 'x-ratelimit-reset'];

/** Wraps a transport and keeps every exchange (without the token). */
export function recordingTransport(inner: Transport) {
  const exchanges: Exchange[] = [];
  const transport: Transport = async (req) => {
    const res = await inner(req);
    const headers = Object.fromEntries(Object.entries(res.headers).filter(([k]) => KEEP_HEADERS.includes(k)));
    exchanges.push({ request: { method: req.method, url: req.url, body: req.body }, response: { status: res.status, headers, body: trim(req, res.body) } });
    return res;
  };
  return { transport, exchanges };
}

/** Commit search returns ~5 KB per hit; keep only the fields the collector reads, so the recording stays small. */
function trim(req: HttpRequest, body: string): string {
  if (!req.url.includes('/search/commits')) return body;
  try {
    const j = JSON.parse(body);
    if (!Array.isArray(j.items)) return body;
    j.items = j.items.map((h: any) => ({ sha: h.sha, html_url: h.html_url, commit: { author: { date: h.commit.author.date }, message: h.commit.message },
      repository: { full_name: h.repository.full_name, private: h.repository.private, fork: h.repository.fork, owner: { login: h.repository.owner.login } } }));
    return JSON.stringify(j);
  } catch { return body; }
}

/** Refuses to save a recording holding anything private: recordings are committed to a public repo. */
export function assertNoPrivate(exchanges: Exchange[]) {
  const leaks = exchanges.filter(e => /"isPrivate":\s*true|"private":\s*true/.test(e.response.body)).length;
  if (leaks) throw new Error(`${leaks} recorded responses contain private data; record with a token limited to public repositories (read-only)`);
}

export function saveRecording(path: string, rec: Recording) {
  assertNoPrivate(rec.exchanges);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, gzipSync(JSON.stringify(rec), { level: 9 }));
}

export const loadRecording = (path: string): Recording => JSON.parse(gunzipSync(readFileSync(path)).toString());

/** Answers each request with its recorded response; an unrecorded request is an error. */
export function replayTransport(rec: Recording): Transport {
  const byKey = new Map<string, HttpResponse[]>();
  for (const e of rec.exchanges) {
    const k = key(e.request);
    byKey.set(k, [...(byKey.get(k) ?? []), e.response]);
  }
  return async (req) => {
    const queue = byKey.get(key(req));
    if (!queue?.length) throw new Error(`no recorded response for ${req.method} ${req.url}`);
    return queue.length > 1 ? queue.shift()! : queue[0];
  };
}
const key = (r: { method: string; url: string; body?: string }) => `${r.method} ${r.url} ${r.body ?? ''}`;
