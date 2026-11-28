import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';

const url = process.env.PREVIEW_URL || 'http://127.0.0.1:3100';
const screenshots = process.env.SCREENSHOT_DIR;
if (screenshots) await mkdir(screenshots, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_BIN });
const desktopStops = new Set(['home', 'api', 'blogs', 'news', 'search-dialog', 'search-results', 'article-top', 'article-section', 'article-nested', 'article-feedback', 'article-dark', 'about', 'policy', 'privacy']);
const compactStops = new Set(['home', 'api', 'blogs', 'news', 'search-results', 'article-top', 'article-nested', 'article-feedback', 'article-dark']);

try {
  for (const [name, width, height] of [['desktop', 1440, 1000], ['tablet', 820, 1180], ['mobile', 390, 844]]) {
      const context = await browser.newContext({
        viewport: { width, height }, colorScheme: name === 'tablet' ? 'dark' : 'light',
        hasTouch: name === 'mobile', isMobile: name === 'mobile',
      });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const capture = async (stop, fullPage = false) => {
      if (!screenshots) return;
      if (name === 'mobile' && !compactStops.has(stop)) return;
      if (name === 'tablet' && !compactStops.has(stop)) return;
      if (name === 'desktop' && !desktopStops.has(stop)) return;
        if (fullPage) await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
        const activeTheme = await page.evaluate(() => document.documentElement.dataset.theme ||
          (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
        await page.screenshot({ path: join(screenshots, `${name}-${stop}-${activeTheme}.png`), fullPage, animations: 'disabled' });
    };

    assert.equal((await page.goto(url)).status(), 200);
    await page.locator('h1').waitFor();
    assert.match(await page.locator('h1').textContent(), /Stories that make the world easier to understand/);
    const header = page.getByRole('banner');
    assert.deepEqual(await header.locator('.top-links a').allTextContents(), ['Explore', 'News', 'Blog', 'Connective AI agent']);
    assert.equal(await page.locator('.sidebar, #explore-menu').count(), 0);
    assert.equal(await header.locator('.top-links a[aria-current="page"]').textContent(), 'Explore');
    const sectionPaths = page.getByRole('navigation', { name: 'Explore article sections and agent access' });
    assert.equal(await sectionPaths.getByRole('link').count(), 4);
    assert.deepEqual(await sectionPaths.locator('a').evaluateAll((links) => links.map((link) => link.getAttribute('href'))),
      ['/news', '/teaching', '/find-out', '/api']);
    const agent = header.getByRole('link', { name: 'Connective AI agent', exact: true });
    assert(await agent.isVisible());
    assert(await agent.evaluate((link) => {
      const bar = link.closest('.topbar-inner').getBoundingClientRect();
      return link.getBoundingClientRect().right > bar.left + bar.width * .6;
    }));
    const leadCover = page.locator('.explore-lead-cover img');
    if (await leadCover.count()) {
      await leadCover.evaluate((img) => img.decode());
      assert(await leadCover.evaluate((img) => img.naturalWidth > 0));
      assert((await leadCover.getAttribute('alt'))?.length > 0);
    } else assert(await page.locator('.explore-lead .cover-placeholder').count());
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await capture('home', true);

    await agent.click();
    await page.waitForURL('**/api');
    assert.equal(await agent.getAttribute('aria-current'), 'page');
    assert.equal(await page.locator('.agent-guide-section').count(), 4);
    await page.getByRole('heading', { name: 'Discover connected reading' }).waitFor();
    await capture('api', true);
    await header.getByRole('link', { name: 'Blog', exact: true }).click();
    await page.waitForURL('**/blogs');
    await page.locator('.blog-archive').waitFor();
    assert.equal(await page.locator('h1').textContent(), 'Blogs');
    for (const image of (await page.locator('.blog-archive img').all()).slice(0, 3)) {
      await image.scrollIntoViewIfNeeded();
      await image.evaluate((element) => element.decode());
      assert(await image.evaluate((element) => element.naturalWidth > 0));
    }
    const sectionDisclosure = page.locator('.browse-dropdown');
    const sectionSummary = sectionDisclosure.locator('summary');
    await sectionSummary.focus();
    await page.keyboard.press('Enter');
    assert.equal(await sectionDisclosure.evaluate((details) => details.open), true, 'dropdown should open from the keyboard');
    assert.deepEqual(await sectionDisclosure.locator('nav a').evaluateAll((links) => links.map((link) => link.getAttribute('href'))),
      ['/teaching', '/find-out', '/news']);
    await page.keyboard.press('Enter');
    assert.equal(await sectionDisclosure.evaluate((details) => details.open), false, 'dropdown should close from the keyboard');
    if (name === 'desktop') {
      await sectionSummary.click();
      assert.equal(await sectionDisclosure.evaluate((details) => details.open), true, 'dropdown should open by mouse');
      await sectionSummary.click();
      assert.equal(await sectionDisclosure.evaluate((details) => details.open), false, 'dropdown should close by mouse');
    }
    if (name === 'mobile') {
      await sectionSummary.tap();
      assert.equal(await sectionDisclosure.evaluate((details) => details.open), true, 'dropdown should open by touch');
      await sectionSummary.tap();
      assert.equal(await sectionDisclosure.evaluate((details) => details.open), false, 'dropdown should close by touch');
    }
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await capture('blogs');
    await page.locator('.top-links').getByRole('link', { name: 'News', exact: true }).click();
    await page.waitForURL('**/news');
    await page.locator('.news-feature').waitFor();
    assert.equal(await page.locator('.news-headlines .news-brief').count(), 2);
    assert.equal(await page.locator('.news-topic-nav a').first().getAttribute('href'), '#latest-stories');
    assert.equal((await page.locator('.news-topic-nav a').allTextContents()).includes('News Analysis'), false);
    const featureBox = await page.locator('.news-feature').boundingBox();
    const headlinesBox = await page.locator('.news-headlines').boundingBox();
    if (width <= 1088) assert(headlinesBox.y > featureBox.y, `${name}: latest headlines should follow the feature`);
    else assert(Math.abs(headlinesBox.y - featureBox.y) < 16, `${name}: desktop headlines should align beside the feature`);
    const brief = page.locator('.news-brief').first();
    const briefMedia = await brief.locator('.news-brief-cover').boundingBox();
    const briefCopy = await brief.locator('.news-brief-copy').boundingBox();
    assert(briefMedia.x + briefMedia.width <= briefCopy.x + 1 || briefMedia.y + briefMedia.height <= briefCopy.y + 1,
      `${name}: brief media must appear before its copy in reading order`);
    for (const image of await page.locator('.news-front .cover img, .news-card .cover img').all()) {
      await image.scrollIntoViewIfNeeded();
      await image.evaluate((element) => element.decode());
      assert(await image.evaluate((element) => element.naturalWidth > 0));
    }
    assert.equal(
      await page.locator('.news-front .image-credit, .news-card .image-credit').count(),
      await page.locator('.news-front .cover img[src*="/media/covers/commons-"], .news-card .cover img[src*="/media/covers/commons-"]').count(),
      `${name}: every Commons newsroom photo must show its attribution`,
    );
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await capture('news');
    const currentNewsArticle = await page.locator('.news-feature-link').getAttribute('href');

    await page.keyboard.press('/');
    await page.getByRole('dialog').waitFor();
    await capture('search-dialog');
    await page.locator('#global-search').fill('website');
    await page.getByRole('dialog').getByRole('button', { name: 'Search', exact: true }).click();
    await page.waitForURL('**/search?q=website');
    await capture('search-results');
    const fixtureArticle = page.getByRole('link', { name: /What happens when you open a website/ });
    if (await fixtureArticle.count()) {
      await fixtureArticle.click();
      await page.waitForURL('**/articles/what-happens-when-you-open-a-website');
      await page.locator('video').waitFor();
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      assert.equal(await page.locator('track').getAttribute('kind'), 'captions');
      assert.equal(await page.locator('.section-disclosure, .section-actions').count(), 0);
      assert(await page.locator('.reading-section').count() > 1);
      await capture('article-top');
      const section = '1. Look up the domain';
      let sectionLink;
      if (name === 'desktop') {
        sectionLink = page.locator('.article-aside').getByRole('link', { name: section });
      } else {
        await page.getByText('On this page', { exact: true }).filter({ visible: true }).click();
        sectionLink = page.locator('.mobile-toc').getByRole('link', { name: section });
      }
      await sectionLink.click();
      await page.waitForURL(/#heading-1-look-up-the-domain$/);
      await page.waitForFunction(() => document.querySelectorAll('[data-reading-outline] a[aria-current="location"][href="#heading-1-look-up-the-domain"]').length === 2);
      await page.waitForFunction(() => Number(document.querySelector('[data-reading-progress]').style.getPropertyValue('--reading-progress')) > 0);
      await capture('article-section');
      await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
      await page.waitForFunction(() => !document.querySelector('[data-reading-outline] a[aria-current]'));
      const nestedName = 'When a cached address is enough';
      const outline = page.locator(name === 'desktop' ? '.article-aside' : '.mobile-toc');
      const nestedLink = outline.getByRole('link', { name: nestedName });
      if (name === 'desktop') {
        await nestedLink.hover();
        await page.getByRole('tooltip').getByText(/reuse a DNS answer/).waitFor();
        await page.keyboard.press('Escape');
        await page.getByRole('tooltip').waitFor({ state: 'hidden' });
        const relatedLink = page.locator('.knowledge-map').getByRole('link').first();
        for (const image of await page.locator('.knowledge-map .connection-cover img').all()) {
          await image.scrollIntoViewIfNeeded();
          await image.evaluate((element) => element.decode());
          assert(await image.evaluate((element) => element.naturalWidth > 0));
          assert((await image.getAttribute('alt'))?.length > 0);
        }
        await relatedLink.scrollIntoViewIfNeeded();
        await relatedLink.hover();
        await page.getByRole('tooltip').getByText(/start of a trail/).waitFor();
      }
      await nestedLink.click();
      await page.waitForURL(/#heading-when-a-cached-address-is-enough$/);
      await page.locator('.prose').getByText(/The browser can reuse a DNS answer/).waitFor();
      assert.equal(await page.locator('.section-disclosure').count(), 0);
      await capture('article-nested');
      await page.locator('#reader-feedback').scrollIntoViewIfNeeded();
      await page.locator('#feedback-title').waitFor();
      assert.match(await page.locator('#reader-feedback').textContent(), /available when OpenBlog is connected to its database/);
      await capture('article-feedback');
    } else {
      const articleResponse = await page.goto(new URL(currentNewsArticle, url).href);
      assert.equal(articleResponse.status(), 200);
      await page.locator('.prose').waitFor();
      assert((await page.locator('h1').innerText()).trim().length > 0);
      assert((await page.locator('.prose').innerText()).trim().length > 100);
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await capture('article-top');
    }

    const nextTheme = name === 'tablet' ? 'light' : 'dark';
    await page.getByRole('button', { name: 'Switch to ' + nextTheme + ' theme' }).click();
    await page.waitForFunction((value) => document.documentElement.dataset.theme === value, nextTheme);
    await page.reload();
    assert.equal(await page.locator('html').getAttribute('data-theme'), nextTheme);
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
    await capture('article-dark', name === 'desktop');
    if (name !== 'tablet') {
      await page.goto(url);
      await page.locator('.explore-hero').waitFor();
      await capture('home', true);
      await page.goto(url + '/api');
      await page.locator('.agent-guide').waitFor();
      await capture('api', true);
    }
    for (const route of ['about', 'policy', 'privacy', 'disclaimer', 'contact']) {
      assert.equal((await page.goto(url + '/' + route)).status(), 200, route);
      await page.locator('h1').waitFor();
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), route + ' overflowed');
      if (['about', 'policy', 'privacy'].includes(route)) await capture(route);
    }
    assert.deepEqual(errors, []);
    await context.close();
    console.log(name + ' browser checks passed');
  }

  const context = await browser.newContext({ viewport: { width: 320, height: 720 }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  await page.goto(url);
  assert.equal(await page.locator('html').evaluate((element) => element.classList.contains('motion')), false);
  assert.equal(await page.locator('.explore-hero-copy').evaluate((element) => getComputedStyle(element).animationName), 'none');
  assert.equal(await page.locator('.explore-lead-cover img').evaluate((element) => getComputedStyle(element).animationName), 'none');
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.goto(url + '/blogs');
  const reducedDisclosure = page.locator('.browse-dropdown');
  await reducedDisclosure.locator('summary').click();
  assert.equal(await reducedDisclosure.locator('.browse-dropdown-panel').evaluate((element) => getComputedStyle(element).animationName), 'none');
  await context.close();
  console.log('Reduced-motion checks passed');
} finally { await browser.close(); }
