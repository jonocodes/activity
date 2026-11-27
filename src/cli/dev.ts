// `just dev`: render, then serve dist/ and re-render whenever src/ changes (run under `node --watch-path=src`).
// Uses state.db if it exists, else the recorded fixture, so no token is needed. Listens on localhost; with --tailnet,
// also on this machine's Tailscale addresses (IPv4 and IPv6, so `http://<host>:<port>` works from a phone).
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { render } from './render.ts';

const PORT = Number(process.env.PORT ?? 8139), OUT = 'dist';
try { await render({ fromRecording: !existsSync('state.db'), out: OUT }); }
catch (e) { console.error(`dev: render failed: ${(e as { problems?: string[] }).problems?.join('; ') ?? (e as Error).message}`); }

const TYPES: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml' };
const serve = createServer((req, res) => {
  let path = normalize(decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
  let file = join(OUT, path);
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
  if (!existsSync(file)) { res.writeHead(404).end('not found'); return; }
  res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' }).end(readFileSync(file));
});

const hosts = ['127.0.0.1'];
if (process.argv.includes('--tailnet')) {
  try { hosts.push(...execFileSync('tailscale', ['ip'], { encoding: 'utf8' }).trim().split('\n').filter(Boolean)); }
  catch { console.error('dev: --tailnet given but `tailscale ip` failed; serving on localhost only'); }
}
for (const host of hosts) {
  const s = host === hosts[0] ? serve : createServer((req, res) => serve.emit('request', req, res));
  s.listen(PORT, host, () => console.log(`dev: http://${host.includes(':') ? `[${host}]` : host}:${PORT}/`));
}
