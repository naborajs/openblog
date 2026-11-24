import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';

const url = process.env.PREVIEW_URL || 'http://127.0.0.1:3100';
const screenshots = process.env.SCREENSHOT_DIR;
if (screenshots) await mkdir(screenshots, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_BIN });

try {
  for (const [name, width, height] of [['desktop', 1440, 1000], ['tablet', 820, 1180], ['mobile', 390, 844]]) {
    const context = await browser.newContext({ viewport: { width, height }, colorScheme: name === 'tablet' ? 'dark' : 'light' });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));

    assert.equal((await page.goto(url)).status(), 200);
    await page.locator('h1').waitFor();
    assert.match(await page.locator('h1').textContent(), /Welcome to OpenBlog/);
    assert.deepEqual(await page.locator('.top-links a').allTextContents(), ['Blogs', 'News']);
    assert.deepEqual(await page.locator('.sidebar .side-link span').allTextContents(), ['Explore', 'News', 'Blog', 'Connective AI agent']);
    await page.waitForFunction(() => document.querySelector('.hero-cover img')?.naturalWidth > 0);
    await page.locator('.hero-cover img').evaluate((img) => img.decode());
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    if (screenshots) await page.screenshot({ path: join(screenshots, name + '.png'), animations: 'disabled' });

    if (name === 'mobile') {
      await page.getByRole('button', { name: 'Open navigation' }).click();
      await page.locator('.sidebar').getByRole('link', { name: 'Blog', exact: true }).click();
      await page.waitForURL('**/blogs');
    } else {
      await page.locator('.top-links').getByRole('link', { name: 'Blogs', exact: true }).click();
      await page.waitForURL('**/blogs');
    }
    await page.locator('.blog-archive').waitFor();
    assert.equal(await page.locator('h1').textContent(), 'Blogs');
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    if (screenshots) await page.screenshot({ path: join(screenshots, name + '-blogs.png'), animations: 'disabled' });
    await page.locator('.top-links').getByRole('link', { name: 'News', exact: true }).click();
    await page.waitForURL('**/news');
    await page.locator('.news-feature').waitFor();
    assert.equal(await page.locator('.news-headlines .news-brief').count(), 2);
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    if (screenshots) await page.screenshot({ path: join(screenshots, name + '-news.png'), animations: 'disabled' });

    await page.keyboard.press('/');
    await page.getByRole('dialog').waitFor();
    await page.locator('#global-search').fill('website');
    await page.getByRole('dialog').getByRole('button', { name: 'Search', exact: true }).click();
    await page.waitForURL('**/search?q=website');
    await page.getByRole('link', { name: /What happens when you open a website/ }).click();
    await page.waitForURL('**/articles/what-happens-when-you-open-a-website');
    await page.locator('video').waitFor();
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    assert.equal(await page.locator('track').getAttribute('kind'), 'captions');
    if (name === 'desktop') {
      await page.locator('.article-aside').getByRole('link', { name: '1. Look up the domain' }).click();
      await page.waitForURL(/#heading-1-look-up-the-domain$/);
    } else {
      await page.getByText('On this page', { exact: true }).filter({ visible: true }).click();
      await page.locator('.mobile-toc a').first().waitFor();
    }

    const nextTheme = name === 'tablet' ? 'light' : 'dark';
    await page.getByRole('button', { name: 'Switch to ' + nextTheme + ' theme' }).click();
    await page.waitForFunction((value) => document.documentElement.dataset.theme === value, nextTheme);
    await page.reload();
    assert.equal(await page.locator('html').getAttribute('data-theme'), nextTheme);
    assert.deepEqual(errors, []);
    if (screenshots && name === 'desktop') await page.screenshot({ path: join(screenshots, 'article-dark.png'), fullPage: true, animations: 'disabled' });
    await context.close();
    console.log(name + ' browser checks passed');
  }

  const context = await browser.newContext({ viewport: { width: 375, height: 812 }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  await page.goto(url);
  assert.equal(await page.locator('html').evaluate((element) => element.classList.contains('motion')), false);
  await context.close();
  console.log('Reduced-motion checks passed');
} finally { await browser.close(); }
