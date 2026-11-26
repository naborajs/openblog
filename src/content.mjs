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

const coverCreditFields = [
  'provider', 'creator', 'license', 'source_url', 'license_url', 'sha256',
  'media_type', 'visual_review', 'relevance',
];

export function agentCoverInput(input, coverOrigin) {
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
      Object.keys(input).sort().join(',') !== 'cover_alt,cover_credit,cover_url') {
    throw new RequestError(400, 'Send only the verified cover URL, alt text, and image-rights record.');
  }

  const expectedOrigin = new URL(coverOrigin);
  if (expectedOrigin.protocol !== 'https:') throw new RequestError(503, 'Cover updates require the public HTTPS site.');
  const image = text(input.cover_url, 180, 'a first-party cover URL', true);
  let imageUrl;
  try { imageUrl = new URL(image); } catch { throw new RequestError(400, 'Use the verified first-party cover path.'); }
  const coverMatch = /^\/media\/covers\/commons-([0-9a-f]{64})-cover\.jpg$/.exec(imageUrl.pathname);
  if (!coverMatch || imageUrl.origin !== expectedOrigin.origin || imageUrl.search || imageUrl.hash || imageUrl.username || imageUrl.password) {
    throw new RequestError(400, 'Use the verified first-party cover path.');
  }

  const alt = text(input.cover_alt, 180, 'an image description', true);
  const source = input.cover_credit;
  if (!source || typeof source !== 'object' || Array.isArray(source) ||
      Object.keys(source).sort().join(',') !== [...coverCreditFields].sort().join(',')) {
    throw new RequestError(400, 'Provide the complete Wikimedia photo-rights record.');
  }
  const clean = {
    provider: text(source.provider, 40, 'the image provider', true),
    creator: text(source.creator, 240, 'the photographer or creator', true),
    license: text(source.license, 120, 'the image license', true),
    source_url: text(source.source_url, 1200, 'the Commons file page', true),
    license_url: text(source.license_url, 300, 'the license page', true),
    sha256: text(source.sha256, 64, 'the image checksum', true).toLowerCase(),
    media_type: text(source.media_type, 24, 'the image type', true),
    visual_review: text(source.visual_review, 500, 'the visual review', true),
    relevance: text(source.relevance, 500, 'the image relevance note', true),
  };
  if (clean.provider !== 'Wikimedia Commons' || clean.media_type !== 'photograph' || clean.sha256 !== coverMatch[1] ||
      !/^[a-f0-9]{64}$/.test(clean.sha256) || /[<>]/.test(clean.creator + clean.license + clean.visual_review + clean.relevance)) {
    throw new RequestError(400, 'The photo-rights record does not match the Commons photograph.');
  }
  const normalizedLicense = clean.license.toLowerCase().replaceAll('-', ' ');
  const isBy = /^cc by (?:2\.0|3\.0|4\.0)$/.test(normalizedLicense);
  const isPublicDomain = /^(?:cc0(?: 1\.0)?|public domain)$/.test(normalizedLicense);
  if (!isBy && !isPublicDomain) throw new RequestError(400, 'Use CC BY, CC0, or public-domain photographs only.');

  let sourceUrl;
  let licenseUrl;
  try {
    sourceUrl = new URL(clean.source_url);
    licenseUrl = new URL(clean.license_url);
  } catch { throw new RequestError(400, 'Use valid HTTPS Commons and license links.'); }
  const licensePath = licenseUrl.pathname.replace(/\/$/, '');
  const allowedLicensePath = isBy
    ? /^\/licenses\/by\/(?:2\.0|3\.0|4\.0)$/.test(licensePath)
    : /^\/publicdomain\/(?:zero|mark)\/1\.0(?:\/deed\.[a-z]{2}(?:-[A-Z]{2})?)?$/.test(licensePath);
  if (sourceUrl.protocol !== 'https:' || sourceUrl.hostname !== 'commons.wikimedia.org' || sourceUrl.username || sourceUrl.password ||
      sourceUrl.search || sourceUrl.hash || !/^\/wiki\/File:[^/]+$/.test(sourceUrl.pathname) ||
      licenseUrl.protocol !== 'https:' || licenseUrl.hostname !== 'creativecommons.org' || licenseUrl.username || licenseUrl.password ||
      licenseUrl.search || licenseUrl.hash || !allowedLicensePath) {
    throw new RequestError(400, 'Use a matching Wikimedia Commons file page and supported license link.');
  }
  return { cover_url: imageUrl.href, cover_alt: alt, cover_credit: clean };
}
