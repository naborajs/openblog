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
if (search && !('closedBy' in HTMLDialogElement.prototype)) {
  function isBackdrop(event) {
    if (event.target !== search) return false;
    const { left, right, top, bottom } = search.getBoundingClientRect();
    return event.clientX < left || event.clientX > right || event.clientY < top || event.clientY > bottom;
  }
  let pressedBackdrop = false;
  search.addEventListener('pointerdown', (event) => { pressedBackdrop = isBackdrop(event); });
  search.addEventListener('click', (event) => {
    if (pressedBackdrop && isBackdrop(event)) search.close();
    pressedBackdrop = false;
  });
}
document.addEventListener('keydown', (event) => {
  if (event.key === '/' && !event.ctrlKey && !event.metaKey && !event.altKey &&
      !event.target.closest('input, textarea, select, [contenteditable="true"]')) {
    event.preventDefault();
    openSearch();
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

const readingProgress = document.querySelector('[data-reading-progress]');
const article = document.querySelector('.article');
if (readingProgress && article) {
  const topbar = readingProgress.closest('.topbar');
  const outlineLinks = new Map();
  for (const link of document.querySelectorAll('[data-reading-outline] a')) {
    const heading = document.getElementById(link.hash.slice(1));
    if (!heading) continue;
    if (!outlineLinks.has(heading)) outlineLinks.set(heading, []);
    outlineLinks.get(heading).push(link);
  }

  let activeHeading;
  let readingFrame;
  function updateReadingPosition() {
    readingFrame = undefined;
    const articleBounds = article.getBoundingClientRect();
    const headerBottom = topbar.getBoundingClientRect().bottom;
    const readingLine = headerBottom + Math.min(120, window.innerHeight * .12);
    const readingDistance = articleBounds.height - (window.innerHeight - headerBottom);
    const progress = readingDistance > 0 ? (headerBottom - articleBounds.top) / readingDistance : 0;
    let nextHeading;
    for (const heading of outlineLinks.keys()) {
      if (!heading.getClientRects().length) continue;
      if (heading.getBoundingClientRect().top > readingLine) break;
      nextHeading = heading;
    }

    readingProgress.style.setProperty('--reading-progress', Math.min(1, Math.max(0, progress)));
    if (nextHeading === activeHeading) return;
    for (const link of outlineLinks.get(activeHeading) ?? []) link.removeAttribute('aria-current');
    for (const link of outlineLinks.get(nextHeading) ?? []) link.setAttribute('aria-current', 'location');
    activeHeading = nextHeading;
  }
  function scheduleReadingUpdate() {
    readingFrame ??= requestAnimationFrame(updateReadingPosition);
  }
  window.addEventListener('scroll', scheduleReadingUpdate, { passive: true });
  window.addEventListener('resize', scheduleReadingUpdate);
  window.addEventListener('pageshow', scheduleReadingUpdate);
  const readingObserver = new ResizeObserver(scheduleReadingUpdate);
  readingObserver.observe(article);
  readingObserver.observe(topbar);
  scheduleReadingUpdate();
}

const preview = document.getElementById('reading-preview');
if (preview) {
  const layout = preview.closest('.article-layout');
  const title = preview.querySelector('strong');
  const excerpt = preview.querySelector('p');
  let trigger;
  let showTimer;
  let hideTimer;
  let pending;

  function hidePreview() {
    clearTimeout(showTimer);
    clearTimeout(hideTimer);
    pending?.abort();
    trigger?.removeAttribute('aria-describedby');
    trigger = undefined;
    preview.hidden = true;
  }

  function positionPreview(link) {
    const anchor = link.getBoundingClientRect();
    const { width, height } = preview.getBoundingClientRect();
    const edge = 12;
    const x = Math.max(edge, Math.min(anchor.left, innerWidth - width - edge));
    const below = anchor.bottom + 6;
    const y = below + height <= innerHeight - edge ? below : Math.max(edge, anchor.top - height - 6);
    preview.style.left = x + 'px';
    preview.style.top = y + 'px';
  }

  function openPreview(link) {
    clearTimeout(hideTimer);
    if (link === trigger) return;
    hidePreview();
    const sectionSummary = link.dataset.sectionPreview;
    const slug = /^\/articles\/([a-z0-9]+(?:-[a-z0-9]+)*)(?:[?#].*)?$/.exec(link.getAttribute('href'))?.[1];
    if (!sectionSummary && (!slug || slug.length > 120)) return;
    trigger = link;
    showTimer = setTimeout(async () => {
      let heading = link.textContent.trim();
      let summary = sectionSummary;
      if (!summary) {
        pending = new AbortController();
        try {
          const response = await fetch('/api/v1/articles/' + slug, { signal: pending.signal, credentials: 'omit', redirect: 'error' });
          if (!response.ok) return;
          const data = await response.json();
          heading = data.title;
          summary = data.summary;
        } catch {
          return;
        }
      }
      if (trigger !== link || typeof heading !== 'string' || typeof summary !== 'string' || !summary.trim()) return;
      title.textContent = heading.slice(0, 150);
      excerpt.textContent = summary.slice(0, 320);
      preview.hidden = false;
      positionPreview(link);
      link.setAttribute('aria-describedby', preview.id);
    }, 220);
  }

  function scheduleHide(event) {
    if (preview.contains(event.relatedTarget) || trigger?.contains(event.relatedTarget)) return;
    clearTimeout(hideTimer);
    hideTimer = setTimeout(hidePreview, 180);
  }

  layout.addEventListener('pointerover', (event) => {
    if (event.pointerType === 'touch') return;
    const link = event.target.closest('a');
    if (link) openPreview(link);
  });
  layout.addEventListener('pointerout', (event) => {
    if (trigger?.contains(event.target) || preview.contains(event.target)) scheduleHide(event);
  });
  preview.addEventListener('pointerenter', () => clearTimeout(hideTimer));
  layout.addEventListener('focusin', (event) => {
    if (event.target.matches('a:focus-visible')) openPreview(event.target);
  });
  layout.addEventListener('focusout', (event) => {
    if (event.target === trigger) scheduleHide(event);
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') hidePreview();
  });
  window.addEventListener('scroll', hidePreview, { passive: true, capture: true });
  window.addEventListener('resize', hidePreview);
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
