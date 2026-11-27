import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shrinkGuard } from '../src/guard.ts';

const live = (items: number | 'missing' | 'down') => async (url: string) => {
  assert.equal(url, 'https://someone.github.io/activity/summary.json');
  if (items === 'down') throw new Error('getaddrinfo ENOTFOUND');
  return items === 'missing' ? { status: 404, body: 'Not Found' } : { status: 200, body: JSON.stringify({ items }) };
};
const check = (previous: Parameters<typeof live>[0], next: number, force = false) =>
  shrinkGuard({ siteUrl: 'https://someone.github.io/activity', next: { items: next }, force, get: live(previous) });

test('the first deploy has nothing to compare with, so it goes ahead', async () => {
  assert.deepEqual(await check('missing', 3000), { deploy: true, message: 'no live summary.json yet (first deploy): deploying 3000 items' });
});

test('growth and small drops deploy', async () => {
  assert.equal((await check(3000, 3100)).deploy, true);
  assert.equal((await check(3000, 2701)).deploy, true, 'a 9.97% drop is within the 10% allowed');
});

test('a drop of more than 10% does not deploy, and says how to override', async () => {
  const r = await check(3000, 2600);
  assert.equal(r.deploy, false);
  assert.equal(r.message, 'items fell from 3000 to 2600 (13%), more than the 10% allowed; not deploying. If the drop is real, run the workflow by hand with "force".');
});

test('force deploys anyway', async () => {
  const r = await check(3000, 10, true);
  assert.equal(r.deploy, true);
  assert.match(r.message, /forced/);
});

test('if the live site cannot be read, it does not deploy (force overrides)', async () => {
  assert.equal((await check('down', 3000)).deploy, false);
  assert.equal((await check('down', 3000, true)).deploy, true);
});
