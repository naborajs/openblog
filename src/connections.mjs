import { defaultTreeAdapter as tree, parseFragment, serialize } from 'parse5';
import { isSlug } from './content.mjs';

const namespace = 'http://www.w3.org/1999/xhtml';
const element = (tag, attrs = {}) => tree.createElement(tag, namespace,
  Object.entries(attrs).map(([name, value]) => ({ name, value })));
const append = (parent, child) => tree.appendChild(parent, child);
const children = (node) => node.childNodes ?? [];
const plain = (node) => node.nodeName === '#text' ? node.value : children(node).map(plain).join('');
const tagLevel = (node) => /^h[1-6]$/.test(node.tagName ?? '') ? Math.max(2, Number(node.tagName[1])) : 0;
const escapePattern = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const ignoredTerms = new Set(['about', 'overview', 'summary', 'introduction', 'conclusion', 'news', 'update', 'guide', 'tutorial']);

export function definitionTopic(title) {
  const term = title.trim().split(/:|\s+[–—]\s+/, 1)[0]
    .replace(/^(?:what (?:is|are)|understanding|introduction to)\s+/i, '')
    .replace(/[?!.]+$/, '').trim();
  if (term.length < 3 || term.length > 48 || ignoredTerms.has(term.toLowerCase())) return '';
  if (!/^[\p{L}\p{N}][\p{L}\p{N}.+# -]*$/u.test(term) || term.split(/\s+/).length > 4) return '';
  if (term.length < 4 && term !== term.toUpperCase()) return '';
  return term;
}

function connectParagraphs(document, candidates, currentSlug) {
  const usedSlugs = new Set([currentSlug]);
  function collectLinks(node) {
    if (node.tagName === 'a') {
      const path = node.attrs.find(({ name }) => name === 'href')?.value;
      const slug = /^\/articles\/([^/#?]+)/.exec(path ?? '')?.[1];
      if (slug) usedSlugs.add(slug);
    }
    children(node).forEach(collectLinks);
  }
  collectLinks(document);
  const terms = new Map();
  for (const { slug, title } of candidates) {
    const term = definitionTopic(title).toLowerCase();
    if (!term || !isSlug(slug)) continue;
    terms.set(term, terms.has(term) ? null : slug);
  }
  const alternatives = [...terms].filter(([, slug]) => slug && !usedSlugs.has(slug))
    .map(([term]) => term).sort((a, b) => b.length - a.length).map(escapePattern);
  if (!alternatives.length) return;
  const matching = new RegExp('(?<![\\p{L}\\p{N}_])(?:' + alternatives.join('|') + ')(?![\\p{L}\\p{N}_])', 'giu');
  let added = 0;
  function visit(node, inParagraph = false) {
    if (['a', 'code', 'pre', 'blockquote'].includes(node.tagName) || added >= 12) return;
    for (const child of [...children(node)]) {
      if (added >= 12) break;
      if (child.nodeName !== '#text' || !inParagraph) {
        visit(child, inParagraph || child.tagName === 'p');
        continue;
      }
      const text = child.value;
      let offset = 0;
      for (const match of text.matchAll(matching)) {
        const slug = terms.get(match[0].toLowerCase());
        if (!slug || usedSlugs.has(slug)) continue;
        tree.insertTextBefore(node, text.slice(offset, match.index), child);
        const link = element('a', { href: '/articles/' + slug, class: 'topic-link' });
        tree.insertText(link, match[0]);
        tree.insertBefore(node, link, child);
        usedSlugs.add(slug);
        offset = match.index + match[0].length;
        if (++added === 12) break;
      }
      if (offset) {
        tree.insertTextBefore(node, text.slice(offset), child);
        tree.detachNode(child);
      }
    }
  }
  visit(document);
}

export function structureArticle(html, candidates, currentSlug) {
  const document = parseFragment(html);
  connectParagraphs(document, candidates, currentSlug);
  const output = tree.createDocumentFragment();
  const outline = [];
  const ancestry = [];
  const ids = new Set();
  for (const node of [...children(document)]) {
    tree.detachNode(node);
    const level = tagLevel(node);
    if (!level) {
      const parent = ancestry.at(-1);
      append(parent?.content ?? output, node);
      const excerpt = plain(node).replace(/\s+/g, ' ').trim();
      if (parent && !parent.summary && node.tagName === 'p' && excerpt) {
        parent.summary = excerpt.length <= 220 ? excerpt : excerpt.slice(0, 217).trimEnd() + '…';
      }
      continue;
    }
    while (ancestry.at(-1)?.level >= level) ancestry.pop();
    const parent = ancestry.at(-1);
    const label = plain(node).trim() || 'Section';
    const base = 'heading-' + (label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'section');
    let id = base;
    for (let index = 2; ids.has(id); index++) id = base + '-' + index;
    ids.add(id);
    const section = element('section', { class: 'reading-section' });
    const heading = element('h' + level, { id });
    for (const child of [...children(node)]) {
      tree.detachNode(child);
      append(heading, child);
    }
    const disclosure = element('details', { open: '', class: 'section-disclosure' });
    const toggle = element('summary', { 'aria-label': 'Toggle section: ' + label });
    const content = element('div', { class: 'section-content' });
    append(disclosure, toggle);
    append(disclosure, content);
    append(section, heading);
    append(section, disclosure);
    append(parent?.content ?? output, section);
    const entry = { id, label, level, summary: '', children: [], content };
    (parent?.children ?? outline).push(entry);
    ancestry.push(entry);
  }
  function clean(entries) {
    return entries.map(({ id, label, level, summary, children: nested }) => ({
      id, label, level, summary, children: clean(nested),
    }));
  }
  return { bodyHtml: serialize(output), headings: clean(outline) };
}
