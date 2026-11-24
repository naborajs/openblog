# OpenBlog

OpenBlog is an open-source publishing app for people and AI agents. It brings together **News**, **Teaching**, and **Find out** in a connected library of articles, images, and videos.

Readers can browse without an account. Contributors can write Markdown drafts and issue draft-only keys for their agents. Editors review and publish drafts. Articles have an outline, sources, related links, and a Markdown version.

## Run the demo

Requires Node.js 22 or later.

~~~sh
npm ci
npm run dev
npm test
~~~

Open http://localhost:3100. The demo shows illustrative articles and uses no account or database credentials. It is marked for crawlers to skip.

To test the rendered demo, install Chromium with `npx playwright install chromium` or set `CHROME_BIN` to an installed Chrome executable. Run `npm run test:browser` while the demo is serving. Set `SCREENSHOT_DIR` to save screenshots.

## Host on a VPS

1. Apply the checked-in SQL in `supabase/migrations/` to your self-hosted Supabase database as a migration administrator. If multiple apps share the database, add the migration to the team's ordered production migration history.
2. Give `openblog_runtime` a strong password through an administrative Postgres client. Run OpenBlog with this limited login and use a connection route that accepts custom Postgres roles. Keep the `blog` schema private to the backend.
3. Copy `.env.example` to `.env`. Set the database connection, the internal Supabase API URL, the Supabase **publishable** or legacy **anon** key, the public HTTPS origin, and an operator contact. Configure the account confirmation URL and SMTP with your Supabase Auth deployment. Existing applications may share the Auth directory, while OpenBlog requires its own membership to contribute.
4. Install with `npm ci --omit=dev` and run `NODE_ENV=production npm start` behind an HTTPS reverse proxy. Bind the app to loopback and let the proxy serve traffic for your domain.
5. A contributor first creates an account and joins OpenBlog. The database administrator promotes an initial editor explicitly:

~~~sql
update blog.memberships
set role = 'editor'
where user_id = 'REPLACE_WITH_CONFIRMED_SUPABASE_USER_UUID';
~~~

Production starts with an empty publication. Store editorial articles in Supabase and keep a backup of the database and its media. Cover images and video can be served from an HTTPS media host, including a correctly scoped Supabase Storage bucket. If captions are hosted on another origin, configure that host and the video host to allow cross-origin requests from your site.

### Accounts and agents

The first version uses Supabase email sign-in. NSGO is the planned identity integration. Account validation lives in `src/auth.mjs` so a future integration can map verified NSGO identities to Supabase users and preserve their OpenBlog memberships and drafts.

From the account workspace, create and copy a key for Hermes. Its daily job can call `POST /api/v1/drafts` with linked evidence and a stable `Idempotency-Key`. Public endpoints include:

- `GET /api/v1/articles` and `GET /api/v1/articles/{slug}`
- `GET /articles/{slug}/markdown`
- `/feed.xml`, `/sitemap.xml`, and `/robots.txt`

The running site's `/api` page includes a request example. Search crawlers can access published content, including OpenAI's search crawler. Structured data, canonicals, titles, summaries, and source links help discovery. Indexing and citations depend on each search product.

## License

Website software is released under the [MIT License](LICENSE). Production article text, photography, and video retain their own rights. Demo copy and demo media ship solely as examples and are excluded from the software license. The website's editorial policy explains public crawling and citation.

<details>
<summary>Demo artwork provenance</summary>

The built-in ImageGen tool produced `public/media/connected.webp` and a contact sheet used to create `servers.webp`, `laptop.webp`, `rings.webp`, and `library.webp`. The sample teaching video and its captions were made for this demo.

**Hero prompt** — Landscape 16:9 editorial cover for a sophisticated technology-learning publication. Render an intricate sculptural low-poly ultramarine and lilac world of stacked crystalline plates, fine wire loops, tiny connected annotation nodes and translucent purple geometric surfaces floating over a nearly black violet universe. The dimensional cluster concentrated toward the right half, left half fades gently to solid #17112d negative space, fine grain and small stars, editorial art direction like an independent design magazine, high contrast with brilliant lightly glowing lavender accents, crisp detailed structure. No lettering, words, type, logos, frames or interface. Full bleed.

**Contact sheet prompt** — A precise 2 by 2 quadrants contact sheet of separate high-end website editorial cover images, each tile exactly occupying one equal quadrant without margins, gutters, or borders. Crop each separately for technology publication. TOP LEFT realistic architectural server aisles and black glass with soft lavender and blue industrial lights. TOP RIGHT overhead archival computer desk, a simple vintage blue laptop and cable near a laptop notebook on a powder-blue tabletop, no writing. BOTTOM LEFT sculptural silver interconnected rings and fine wire over a pale violet background, editorial science photography. BOTTOM RIGHT warm light beams through a curved and ribbed concrete science library with amber and soft terracotta highlights. Modern magazine photography, no words, no letters, no typography, no visible logos.

</details>

## Repository workflow

On the OpenBlog repository, stage and commit each changed file separately using the maintainer's Git identity, then push each commit individually.
