const themeKey = 'bmec-site-theme';
const root = document.documentElement;
let savedTheme;
try { savedTheme = localStorage.getItem(themeKey); } catch { savedTheme = null; }
if (savedTheme === 'light' || savedTheme === 'dark') root.dataset.theme = savedTheme;

function setTheme(theme) {
  root.dataset.theme = theme;
  const themeColor = document.querySelector('meta[name="theme-color"]');
  if (themeColor) themeColor.content = theme === 'dark' ? '#08090b' : '#f7f7f8';
  try { localStorage.setItem(themeKey, theme); } catch { /* Theme still works for this page. */ }
  for (const button of document.querySelectorAll('[data-theme-toggle]')) {
    const next = theme === 'dark' ? 'light' : 'dark';
    button.setAttribute('aria-label', `Switch to ${next} theme`);
    button.setAttribute('title', `Switch to ${next} theme`);
    const label = button.querySelector('[data-theme-label]');
    if (label) label.textContent = next === 'light' ? 'Light' : 'Dark';
  }
}

setTheme(root.dataset.theme === 'light' ? 'light' : 'dark');
for (const button of document.querySelectorAll('[data-theme-toggle]')) {
  button.addEventListener('click', () => setTheme(root.dataset.theme === 'dark' ? 'light' : 'dark'));
}

for (const button of document.querySelectorAll('.nav-toggle')) {
  const nav = document.getElementById(button.getAttribute('aria-controls'));
  if (!nav) continue;
  button.addEventListener('click', () => {
    const open = button.getAttribute('aria-expanded') !== 'true';
    button.setAttribute('aria-expanded', String(open));
    nav.classList.toggle('is-open', open);
  });
  nav.addEventListener('click', event => {
    if (!event.target.closest('a')) return;
    button.setAttribute('aria-expanded', 'false');
    nav.classList.remove('is-open');
  });
}

const librarySearch = document.querySelector('[data-library-search]');
if (librarySearch) {
  const entries = [...document.querySelectorAll('[data-library-entry]')];
  librarySearch.addEventListener('input', () => {
    const query = librarySearch.value.trim().toLocaleLowerCase();
    let visible = 0;
    for (const entry of entries) {
      const matches = !query || entry.dataset.searchText.includes(query);
      entry.hidden = !matches;
      if (matches) visible += 1;
    }
    const count = document.getElementById('library-count');
    if (count) count.textContent = `${visible} example${visible === 1 ? '' : 's'}`;
    const empty = document.getElementById('library-empty');
    if (empty) empty.hidden = visible !== 0;
  });
}

const docsSearch = document.querySelector('[data-doc-search]');
if (docsSearch) {
  const entries = [...document.querySelectorAll('[data-doc-entry]')];
  const groups = [...document.querySelectorAll('.docs-group')];
  const count = document.getElementById('docs-count');
  const empty = document.getElementById('docs-no-results');
  docsSearch.addEventListener('input', () => {
    const query = docsSearch.value.trim().toLocaleLowerCase();
    let visible = 0;
    for (const entry of entries) {
      const matches = !query || entry.dataset.searchText.includes(query);
      entry.hidden = !matches;
      if (matches) visible += 1;
    }
    for (const group of groups) {
      group.hidden = !group.querySelector('[data-doc-entry]:not([hidden])');
    }
    if (count) count.textContent = `${visible} guide${visible === 1 ? '' : 's'}`;
    if (empty) empty.hidden = visible !== 0;
  });
}

document.addEventListener('click', async event => {
  const button = event.target.closest('[data-copy-code]');
  if (!button) return;
  const target = document.getElementById(button.getAttribute('data-copy-code'));
  if (!target) return;
  try {
    await navigator.clipboard.writeText(target.textContent ?? '');
    button.textContent = 'Copied';
    setTimeout(() => { button.textContent = 'Copy code'; }, 1600);
  } catch {
    button.textContent = 'Select code to copy';
  }
});
