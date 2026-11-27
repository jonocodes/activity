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
