const root = document.documentElement;
const theme = document.querySelector('[data-theme-toggle]');
const darkPreference = window.matchMedia('(prefers-color-scheme: dark)');
const currentTheme = () => root.dataset.theme || (darkPreference.matches ? 'dark' : 'light');

function describeTheme() {
  theme?.setAttribute('aria-label', currentTheme() === 'dark' ? 'Switch to light theme' : 'Switch to dark theme');
}
theme?.addEventListener('click', () => {
  const next = currentTheme() === 'dark' ? 'light' : 'dark';
  const update = () => {
    root.dataset.theme = next;
    try { localStorage.setItem('openblog-theme', next); } catch { /* Temporary theme still works. */ }
    describeTheme();
  };
  if (document.startViewTransition && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    document.startViewTransition(update);
  } else update();
});
darkPreference.addEventListener('change', describeTheme);
describeTheme();

const search = document.querySelector('.search-dialog');
const searchBox = document.querySelector('#global-search');
function openSearch() {
  if (!search?.open) {
    search?.showModal();
    searchBox?.focus();
  }
}
document.querySelector('[data-search-open]')?.addEventListener('click', openSearch);
search?.addEventListener('click', (event) => {
  if (event.target === search && !search.querySelector('.search-dialog-body')?.contains(event.target)) {
    const bounds = search.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) search.close();
  }
});
document.addEventListener('keydown', (event) => {
  if (event.key === '/' && !event.ctrlKey && !event.metaKey && !event.altKey &&
      !event.target.closest('input, textarea, select, [contenteditable="true"]')) {
    event.preventDefault();
    openSearch();
  }
});

const menuButton = document.querySelector('[data-menu-toggle]');
const menu = document.querySelector('#explore-menu');
if (!menu) menuButton?.remove();
function toggleMenu(open) {
  menu?.classList.toggle('is-open', open);
  menuButton?.setAttribute('aria-expanded', String(open));
  menuButton?.setAttribute('aria-label', open ? 'Close navigation' : 'Open navigation');
}
menuButton?.addEventListener('click', () => toggleMenu(menuButton.getAttribute('aria-expanded') !== 'true'));
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && menuButton?.getAttribute('aria-expanded') === 'true') {
    toggleMenu(false);
    menuButton.focus();
  }
});
document.addEventListener('click', (event) => {
  if (menuButton?.getAttribute('aria-expanded') === 'true' && !menu?.contains(event.target) && !menuButton.contains(event.target)) {
    toggleMenu(false);
  }
});

if ('IntersectionObserver' in window && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      entry.target.classList.add('is-visible');
      observer.unobserve(entry.target);
    }
  }, { threshold: .1 });
  root.classList.add('motion');
  document.querySelectorAll('.reveal').forEach((item) => observer.observe(item));
} else {
  document.querySelectorAll('.reveal').forEach((item) => item.classList.add('is-visible'));
}

for (const button of document.querySelectorAll('[data-copy-link], [data-copy-key]')) {
  button.addEventListener('click', async () => {
    const value = button.hasAttribute('data-copy-key')
      ? document.querySelector('#new-agent-key')?.textContent
      : document.querySelector('link[rel=canonical]')?.href || location.href;
    try {
      await navigator.clipboard.writeText(value);
      button.textContent = 'Copied';
    } catch {
      button.textContent = 'Select and copy';
      const key = document.querySelector('#new-agent-key');
      if (key) {
        const range = document.createRange();
        range.selectNodeContents(key);
        window.getSelection()?.removeAllRanges();
        window.getSelection()?.addRange(range);
      }
    }
  });
}

const confirmation = document.querySelector('[data-auth-confirm]');
if (confirmation && location.hash) {
  const tokens = new URLSearchParams(location.hash.slice(1));
  const access = tokens.get('access_token');
  const refresh = tokens.get('refresh_token');
  if (access && refresh) {
    confirmation.elements.access_token.value = access;
    confirmation.elements.refresh_token.value = refresh;
    history.replaceState(null, '', location.pathname);
  }
  if (tokens.get('error')) confirmation.querySelector('[data-auth-message]').textContent = 'This confirmation link is invalid or expired.';
}
