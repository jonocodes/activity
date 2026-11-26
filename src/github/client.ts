// The only way the collector talks to GitHub. Every request goes through one replaceable transport, so tests can
// replay recorded responses or a fake API. Retries, rate-limit waits and the "this run fails" rules live here.

export interface HttpRequest { method: 'GET' | 'POST'; url: string; headers: Record<string, string>; body?: string }
/** Header names are lower-case. */
export interface HttpResponse { status: number; headers: Record<string, string>; body: string }
export type Transport = (req: HttpRequest) => Promise<HttpResponse>;

/** A failure that ends the run without deploying. Messages carry no item titles. */
export class CollectError extends Error {}

export interface ClientOptions {
  transport: Transport;
  token: string;
  sleep?: (ms: number) => Promise<void>;
  /** Rate-limit waits up to this long are waited out; longer ones fail the run. */
  maxWaitMs?: number;
  /** Attempts for server and network errors. */
  attempts?: number;
}

export interface GraphQLOptions { /** Tolerate NOT_FOUND errors (deleted or renamed repos come back null). */ allowNotFound?: boolean }

export interface Client {
  graphql<T = any>(query: string, variables: Record<string, unknown>, options?: GraphQLOptions): Promise<T>;
  rest<T = any>(path: string): Promise<T>;
  /** API calls made so far, counting retries. */
  calls(): number;
}

const API = 'https://api.github.com';

export const fetchTransport: Transport = async (req) => {
  const r = await fetch(req.url, { method: req.method, headers: req.headers, body: req.body });
  const headers: Record<string, string> = {};
  r.headers.forEach((v, k) => { headers[k.toLowerCase()] = v; });
  return { status: r.status, headers, body: await r.text() };
};

export function createClient(o: ClientOptions): Client {
  const sleep = o.sleep ?? (ms => new Promise(r => setTimeout(r, ms)));
  const maxWaitMs = o.maxWaitMs ?? 90_000;
  const attempts = o.attempts ?? 4;
  let calls = 0;
  const headers = { authorization: `bearer ${o.token}`, 'user-agent': 'activity-page', accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28' };

  async function send(req: HttpRequest): Promise<HttpResponse> {
    const what = req.method === 'POST' ? 'GraphQL request' : req.url.replace(API, '');
    for (let attempt = 1; ; attempt++) {
      let res: HttpResponse;
      try { calls++; res = await o.transport(req); }
      catch (e) {
        if (attempt < attempts) { await sleep(1000 * 2 ** (attempt - 1)); continue; }
        throw new CollectError(`${what}: network error after ${attempts} attempts (${(e as Error).message})`);
      }
      if (res.status >= 200 && res.status < 300) return res;
      const wait = rateLimitWait(res);
      if (wait !== null) {
        if (wait > maxWaitMs) throw new CollectError(`${what}: rate limited for ${Math.round(wait / 1000)} s, longer than the ${Math.round(maxWaitMs / 1000)} s limit`);
        await sleep(wait);
        attempt--; // waiting out a rate limit doesn't use up an attempt
        continue;
      }
      if (res.status >= 500 && attempt < attempts) { await sleep(1000 * 2 ** (attempt - 1)); continue; }
      throw new CollectError(`${what}: HTTP ${res.status}${res.status >= 500 ? ` after ${attempts} attempts` : ''}${apiMessage(res)}`);
    }
  }

  return {
    calls: () => calls,
    async rest(path) {
      const res = await send({ method: 'GET', url: API + path, headers });
      return JSON.parse(res.body);
    },
    async graphql(query, variables, options = {}) {
      const res = await send({ method: 'POST', url: `${API}/graphql`, headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify({ query, variables }) });
      const json = JSON.parse(res.body);
      const errors: { type?: string; message?: string }[] = json.errors ?? [];
      const fatal = errors.filter(e => !(options.allowNotFound && e.type === 'NOT_FOUND'));
      if (fatal.length) throw new CollectError(`GraphQL ${operationName(query)}: ${fatal.map(e => [e.type, e.message].filter(Boolean).join(": ")).join(', ')}`);
      return json.data;
    },
  };
}

/** How long to wait for a rate limit to lift, or null if the response isn't a rate limit. */
function rateLimitWait(res: HttpResponse): number | null {
  if (res.status !== 403 && res.status !== 429) return null;
  const retryAfter = Number(res.headers['retry-after']);
  if (retryAfter > 0) return retryAfter * 1000;
  if (res.headers['x-ratelimit-remaining'] === '0' && res.headers['x-ratelimit-reset']) return Math.max(1000, Number(res.headers['x-ratelimit-reset']) * 1000 - Date.now() + 1000);
  if (res.status === 429 || /rate limit/i.test(res.body)) return 60_000;
  return null;
}

const apiMessage = (res: HttpResponse) => { try { const m = JSON.parse(res.body).message; return m ? ` (${m})` : ''; } catch { return ''; } };
const operationName = (query: string) => /^\s*query\s+(\w+)/.exec(query)?.[1] ?? 'query';
