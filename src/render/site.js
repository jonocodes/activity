// Progressive enhancement for the pre-rendered page. Without this script everything still reads: tabs are jump links,
// older years are links to their own pages, and dates are plain dates.
(() => {
  const $ = (s, el = document) => el.querySelector(s), $$ = (s, el = document) => [...el.querySelectorAll(s)];

  // ---------- dates: hover shows the exact time in the visitor's own time zone; items under a week old say how long ago ----------
  // Days, groups and weeks stay in the owner's time zone (built once for everyone); these two are right for every visitor.
  const local = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  const ages = (root) => {
    const now = Date.now();
    for (const t of $$('time[datetime]', root)) {
      if (t.dataset.done) continue;
      t.dataset.done = '1';
      t.title = `${local.format(new Date(t.dateTime))}, your time`;
      const s = (now - Date.parse(t.dateTime)) / 1000;
      if (s < 0 || s > 7 * 86400) continue;
      t.textContent = s < 3600 ? `${Math.max(1, Math.round(s / 60))} min ago` : s < 86400 ? `${Math.floor(s / 3600)} h ago` : `${Math.floor(s / 86400)} d ago`;
    }
  };

  // ---------- tabs ----------
  const panels = $$('[data-panel]'), links = $$('nav.tabs a');
  const show = (id) => {
    if (!panels.some(p => p.id === id)) id = panels[0]?.id;
    for (const p of panels) p.hidden = p.id !== id;
    for (const a of links) a.classList.toggle('on', a.hash === `#${id}`);
  };
  if (panels.length) {
    document.body.classList.add('js-tabs');
    for (const a of links) a.addEventListener('click', e => { e.preventDefault(); history.replaceState(null, '', a.hash); show(a.hash.slice(1)); });
    show(location.hash.slice(1));
  }

  // ---------- feed filters: kind chips and one repo ----------
  const feed = $('#feed');
  const state = { off: new Set(), repos: null };
  const apply = (root = feed) => {
    if (!root) return;
    for (const r of $$('.row[data-kind]', root)) r.hidden = state.off.has(r.dataset.kind) || (state.repos !== null && !state.repos.includes(r.dataset.repo));
    for (const w of $$('.week', root)) w.hidden = !$$('.row[data-kind]', w).some(r => !r.hidden);
    for (const c of $$('.chip', feed)) c.classList.toggle('off', state.off.has(c.dataset.kind));
    const banner = $('.filter', feed);
    if (banner) { banner.hidden = state.repos === null; if (state.repos) $('b', banner).textContent = state.repos[0]; }
  };
  if (feed) {
    const counts = JSON.parse(feed.dataset.counts || '{}'), labels = JSON.parse(feed.dataset.labels || '{}');
    const chips = document.createElement('div');
    chips.className = 'chips';
    for (const [kind, n] of Object.entries(counts)) {
      const b = document.createElement('button');
      b.className = 'chip'; b.dataset.kind = kind; b.type = 'button';
      b.innerHTML = `<i class="k-${kind}"></i>`; b.append(`${labels[kind] ?? kind} ${n.toLocaleString()}`);
      b.addEventListener('click', () => { state.off.has(kind) ? state.off.delete(kind) : state.off.add(kind); apply(); });
      chips.append(b);
    }
    const banner = document.createElement('p');
    banner.className = 'filter'; banner.hidden = true;
    banner.innerHTML = 'Only <b></b> · <button type="button">show everything</button>';
    $('button', banner).addEventListener('click', () => { state.repos = null; apply(); });
    feed.querySelector('h2')?.after(chips, banner);
    for (const b of $$('[data-filter]')) {
      const btn = document.createElement('button');
      btn.type = 'button'; btn.className = 'in-feed'; btn.textContent = 'in feed';
      btn.addEventListener('click', () => { state.repos = b.dataset.filter.split(' '); show('feed'); history.replaceState(null, '', '#feed'); apply(); scrollTo(0, feed.offsetTop - 10); });
      (b.firstElementChild ?? b).append(btn);
    }
    apply();
  }

  // ---------- repo lists: Top (the default order) · Recent · Most work ----------
  const ORDERS = [['top', 'Top', 'A lot of work, weighted towards recent'], ['recent', 'Recent', 'Most recently active first'], ['total', 'Most work', 'Most commits, pull requests, issues and discussions, all time']];
  const key = { top: r => +r.dataset.score, recent: r => Date.parse(r.dataset.last || 0), total: r => +r.dataset.total };
  for (const list of $$('[data-sortable]')) {
    const bar = document.createElement('p');
    bar.className = 'sort';
    bar.append('Sort: ');
    const buttons = ORDERS.map(([id, label, title], i) => {
      const b = document.createElement('button');
      b.type = 'button'; b.textContent = label; b.title = title; b.dataset.order = id;
      if (i === 0) b.classList.add('on');
      b.addEventListener('click', () => {
        const rows = $$(':scope > .proj', list);
        rows.sort((a, c) => key[id](c) - key[id](a) || +c.dataset.score - +a.dataset.score);
        list.append(...rows);
        for (const x of buttons) x.classList.toggle('on', x === b);
      });
      if (i) bar.append(' · ');
      bar.append(b);
      return b;
    });
    list.before(bar);
  }

  // ---------- heatmap tooltips: on hover with a mouse, on tap with a finger ----------
  const tip = document.createElement('div');
  tip.className = 'tip'; tip.hidden = true; document.body.append(tip);
  const showTip = (el) => {
    const r = el.getBoundingClientRect();
    tip.textContent = el.dataset.tip; tip.hidden = false;
    const half = tip.offsetWidth / 2, x = Math.min(Math.max(r.left + r.width / 2, half + 4), innerWidth - half - 4);
    tip.style.left = `${x + scrollX}px`; tip.style.top = `${r.top + scrollY}px`;
  };
  for (const s of $$('.heat-scroll')) s.scrollLeft = s.scrollWidth;
  addEventListener('scroll', () => { tip.hidden = true; }, { capture: true, passive: true });
  document.addEventListener('pointerover', e => { const el = e.target.closest?.('[data-tip]'); if (el && e.pointerType === 'mouse') showTip(el); });
  document.addEventListener('pointerout', e => { if (e.target.closest?.('[data-tip]') && e.pointerType === 'mouse') tip.hidden = true; });
  document.addEventListener('click', e => { const el = e.target.closest?.('[data-tip]'); if (el) showTip(el); else tip.hidden = true; });
  for (const t of $$('svg.heat title')) t.remove();   // the tooltip replaces the browser's slow one

  // ---------- older years load in place when opened ----------
  for (const d of $$('details.year')) {
    d.addEventListener('toggle', async () => {
      const body = $('.year-body', d);
      if (!d.open || body.dataset.loaded) return;
      body.dataset.loaded = '1';
      const link = $('a', body);
      try {
        const page = new DOMParser().parseFromString(await (await fetch(link.href)).text(), 'text/html');
        body.replaceChildren(...$('#year-body', page).childNodes);
        ages(body); apply(body);
      } catch { body.dataset.loaded = ''; }
    });
  }

  ages(document);
})();
