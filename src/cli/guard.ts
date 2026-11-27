// The workflow's last check before deploying: compares dist/summary.json with the live site's (see src/guard.ts).
// SITE_URL is the Pages URL; FORCE=true deploys anyway. Exits non-zero to stop the deploy.
import { readFileSync } from 'node:fs';
import { shrinkGuard } from '../guard.ts';

const siteUrl = process.env.SITE_URL;
if (!siteUrl) { console.error('guard: SITE_URL is not set'); process.exit(1); }
const next = JSON.parse(readFileSync('dist/summary.json', 'utf8'));
const r = await shrinkGuard({ siteUrl, next, force: process.env.FORCE === 'true' });
console[r.deploy ? 'log' : 'error'](`guard: ${r.message}`);
process.exit(r.deploy ? 0 : 1);
