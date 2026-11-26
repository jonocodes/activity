import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClient, CollectError, type HttpRequest, type HttpResponse } from '../src/github/client.ts';

// A scripted transport: each call takes the next response (or throws it, for network errors).
function scripted(...responses: (HttpResponse | Error)[]) {
  const seen: HttpRequest[] = [];
  const transport = async (req: HttpRequest) => {
    seen.push(req);
    const r = responses.shift();
    if (!r) throw new Error('no more scripted responses');
    if (r instanceof Error) throw r;
    return r;
  };
  return { transport, seen };
}
const ok = (body: unknown, headers: Record<string, string> = {}): HttpResponse => ({ status: 200, headers, body: JSON.stringify(body) });
const status = (code: number, body: unknown = {}, headers: Record<string, string> = {}): HttpResponse => ({ status: code, headers, body: JSON.stringify(body) });
const sleeps: number[] = [];
const sleep = async (ms: number) => { sleeps.push(ms); };
const client = (transport: (r: HttpRequest) => Promise<HttpResponse>, maxWaitMs = 90_000) => createClient({ transport, token: 't0ken', sleep, maxWaitMs });

test('graphql posts the query with the token and returns data', async () => {
  const { transport, seen } = scripted(ok({ data: { user: { login: 'x' } } }));
  const gh = client(transport);
  assert.deepEqual(await gh.graphql('query Q { user { login } }', {}), { user: { login: 'x' } });
  assert.equal(seen[0].method, 'POST');
  assert.equal(seen[0].url, 'https://api.github.com/graphql');
  assert.equal(seen[0].headers.authorization, 'bearer t0ken');
  assert.equal(gh.calls(), 1);
});

test('a GraphQL response carrying errors fails the run', async () => {
  const { transport } = scripted(ok({ data: null, errors: [{ type: 'FORBIDDEN', message: 'nope' }] }));
  await assert.rejects(client(transport).graphql('query Q { x }', {}), (e: Error) => e instanceof CollectError && /nope/.test(e.message));
});

test('NOT_FOUND errors can be allowed, for repos that were deleted or renamed', async () => {
  const { transport } = scripted(ok({ data: { a: { n: 1 }, b: null }, errors: [{ type: 'NOT_FOUND', message: 'Could not resolve' }] }));
  assert.deepEqual(await client(transport).graphql('query Q { x }', {}, { allowNotFound: true }), { a: { n: 1 }, b: null });
});

test('server errors are retried, then succeed', async () => {
  sleeps.length = 0;
  const { transport, seen } = scripted(status(502), new Error('socket hang up'), ok({ items: [] }));
  assert.deepEqual(await client(transport).rest('/x'), { items: [] });
  assert.equal(seen.length, 3);
  assert.equal(sleeps.length, 2);
});

test('an API error that persists after retries fails the run', async () => {
  const { transport } = scripted(status(500), status(500), status(500), status(500));
  await assert.rejects(client(transport).rest('/x'), (e: Error) => e instanceof CollectError && /500/.test(e.message));
});

test('a client error fails at once, without retrying', async () => {
  const { transport, seen } = scripted(status(404, { message: 'Not Found' }));
  await assert.rejects(client(transport).rest('/x'), CollectError);
  assert.equal(seen.length, 1);
});

test('a short rate-limit wait is waited out', async () => {
  sleeps.length = 0;
  const { transport } = scripted(status(403, { message: 'API rate limit exceeded' }, { 'retry-after': '30' }), ok({ fine: true }));
  assert.deepEqual(await client(transport).rest('/x'), { fine: true });
  assert.deepEqual(sleeps, [30_000]);
});

test('a rate-limit reset time is used when there is no Retry-After', async () => {
  sleeps.length = 0;
  const reset = Math.floor(Date.now() / 1000) + 20;
  const { transport } = scripted(status(403, {}, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(reset) }), ok({ fine: true }));
  await client(transport).rest('/x');
  assert.ok(sleeps[0] > 15_000 && sleeps[0] <= 21_000, `waited ${sleeps[0]} ms`);
});

test('a long rate-limit wait fails the run', async () => {
  const { transport } = scripted(status(429, {}, { 'retry-after': '3600' }));
  await assert.rejects(client(transport, 90_000).rest('/x'), (e: Error) => e instanceof CollectError && /rate limit/i.test(e.message));
});
