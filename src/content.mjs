import { marked } from 'marked';
import { sections } from './demo.mjs';

export class RequestError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function text(value, max, label, required = false) {
  const result = typeof value === 'string' ? value.trim() : '';
  if ((required && !result) || result.length > max) throw new RequestError(400, `Enter ${label} with no more than ${max} characters.`);
  return result;
}

const code = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const isSlug = (value) => typeof value === 'string' && value.length <= 120 && code.test(value);
export const isId = (value) => /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);

function validUrl(value, label, local = false) {
  const cleaned = text(value, 1500, label);
  if (!cleaned) return null;
  if (local && /^\/media\/[a-zA-Z0-9_.-]+$/.test(cleaned) && !cleaned.includes('..')) return cleaned;
  try {
    const url = new URL(cleaned);
    if (url.protocol === 'https:' && !url.username && !url.password) return url.href;
  } catch { /* report a readable validation error below */ }
  throw new RequestError(400, `Use a secure HTTPS URL for ${label}.`);
}

export function articleInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new RequestError(400, 'Provide an article object.');
  const section = text(input.section, 12, 'a section', true);
  if (!Object.hasOwn(sections, section)) throw new RequestError(400, 'Choose News, Teaching, or Find out.');

  const related = Array.isArray(input.related_slugs) ? input.related_slugs
    : text(input.related, 800, 'related articles').split(',').map((item) => item.trim()).filter(Boolean);
  if (related.length > 8 || related.some((item) => !isSlug(item))) throw new RequestError(400, 'Provide up to eight valid related article slugs.');
  const sources = Array.isArray(input.sources) ? input.sources
    : text(input.source_urls, 12000, 'source URLs').split(/\r?\n/).map((url) => url.trim()).filter(Boolean).map((url) => ({ url }));
  if (sources.length > 12) throw new RequestError(400, 'Provide up to twelve sources.');
  const cleanSources = sources.map((source) => {
    const url = validUrl(source?.url, 'each source');
    if (!url) throw new RequestError(400, 'Each source needs a URL.');
    return { url, title: text(source?.title, 180, 'the source title') || new URL(url).hostname };
  });

  const cover = validUrl(input.cover_url, 'the cover image', true);
  const coverAlt = text(input.cover_alt, 180, 'the cover image description', Boolean(cover));
  const video = validUrl(input.video_url, 'the video', true);
  const captions = validUrl(input.video_captions, 'the captions', true);
  const transcript = text(input.transcript, 15000, 'the video transcript', Boolean(video));
  const body = text(input.body, 50000, 'the Markdown article', true);
  const linkedArticles = new Set(related);
  marked.walkTokens(marked.lexer(body), (token) => {
    if (token.type !== 'link' || linkedArticles.size >= 8) return;
    const slug = /^\/articles\/([^/#?]+)(?:#.*)?$/.exec(token.href)?.[1];
    if (isSlug(slug)) linkedArticles.add(slug);
  });
  return {
    section,
    title: text(input.title, 150, 'a title', true),
    topic: text(input.topic, 60, 'a topic'),
    summary: text(input.summary, 320, 'a short summary', true),
    body,
    cover_url: cover,
    cover_alt: coverAlt || null,
    video_url: video,
    video_captions: captions,
    transcript: transcript || null,
    sources: cleanSources,
    related_slugs: [...linkedArticles],
  };
}
