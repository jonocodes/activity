// The shrink guard: with no state store, a run that quietly collected less would publish a thinner page. Compare the new
// summary.json with the live one and refuse to deploy if items fell by more than 10%. See docs/design.md, "When a run fails".

export const MAX_DROP = 0.10;

export interface GuardOptions {
  siteUrl: string;
  next: { items: number };
  force: boolean;
  /** Fetches a URL; injectable for tests. */
  get?: (url: string) => Promise<{ status: number; body: string }>;
}

export async function shrinkGuard(o: GuardOptions): Promise<{ deploy: boolean; message: string }> {
  const get = o.get ?? (async (url: string) => { const r = await fetch(url, { headers: { 'cache-control': 'no-cache' } }); return { status: r.status, body: await r.text() }; });
  const url = `${o.siteUrl.replace(/\/?$/, '/')}summary.json`;
  let previous: number;
  try {
    const r = await get(url);
    if (r.status === 404) return { deploy: true, message: `no live summary.json yet (first deploy): deploying ${o.next.items} items` };
    if (r.status !== 200) throw new Error(`HTTP ${r.status}`);
    previous = Number(JSON.parse(r.body).items);
    if (!Number.isFinite(previous)) throw new Error('no item count in it');
  } catch (e) {
    const why = `couldn't read the live summary.json (${(e as Error).message})`;
    return o.force ? { deploy: true, message: `${why}; deploying anyway (forced)` } : { deploy: false, message: `${why}; not deploying. Run the workflow by hand with "force" to deploy anyway.` };
  }
  const drop = previous > 0 ? (previous - o.next.items) / previous : 0;
  const pct = `${Math.round(drop * 100)}%`;
  if (drop <= MAX_DROP) return { deploy: true, message: `items: ${previous} live, ${o.next.items} now: deploying` };
  if (o.force) return { deploy: true, message: `items fell from ${previous} to ${o.next.items} (${pct}); deploying anyway (forced)` };
  return { deploy: false, message: `items fell from ${previous} to ${o.next.items} (${pct}), more than the ${MAX_DROP * 100}% allowed; not deploying. If the drop is real, run the workflow by hand with "force".` };
}
