export const sections = {
  news: { title: 'News', description: 'Updates worth understanding, with the context behind them.', symbol: '◫' },
  teaching: { title: 'Teaching', description: 'Practical guides and explainers you can put to use.', symbol: '◇' },
  'find-out': { title: 'Find out', description: 'Follow a question and see where it leads.', symbol: '✳' },
};

const base = { author_name: 'OpenBlog Demo', published_at: '2026-11-24T10:00:00Z', updated_at: '2026-11-24T10:00:00Z' };

export const demoArticles = [
  {
    ...base, slug: 'how-knowledge-stays-connected', section: 'find-out', topic: 'The open web',
    title: 'Knowledge is better connected.',
    summary: 'What happens when an article is the start of a trail? Follow the links that turn isolated pages into a web of ideas.',
    cover_url: '/media/connected.webp', cover_alt: 'Glowing violet geometric forms connected by fine lines',
    related_slugs: ['what-happens-when-you-open-a-website', 'what-an-api-actually-does'],
    sources: [{ title: 'W3C Architecture of the World Wide Web', url: 'https://www.w3.org/TR/webarch/' }],
    body: [
      '## Why do links matter?',
      'A link gives a reader a way to verify a claim, learn a term, or follow a question without stopping the story. A few meaningful links are enough to make a page part of a larger body of knowledge.',
      '## Choose a useful next step',
      'Label links with their destination. If a paragraph mentions a browser, link to a page that explains [what happens when you open a website](/articles/what-happens-when-you-open-a-website). Readers can choose how much context they need.',
      '## Read in both directions',
      'A related reading list can show pages cited by an article and pages that cite it in return. That gives a reader who arrives from search the same paths as someone browsing the homepage.',
    ].join('\n\n'),
  },
  {
    ...base, slug: 'read-a-technology-release', section: 'news', topic: 'Technology',
    title: 'How to read a technology release',
    summary: 'Make sense of a release announcement by checking what shipped, who gets it, and what changes in practice.',
    cover_url: '/media/servers.webp', cover_alt: 'Server racks in a cool violet-lit corridor',
    related_slugs: ['spot-a-useful-source'],
    sources: [{ title: 'GitHub documentation about releases', url: 'https://docs.github.com/en/repositories/releasing-projects-on-github/about-releases' }],
    body: '## Start with what shipped\n\nLook for a version or rollout date. Read the release notes alongside the announcement to separate what is available from what is planned.\n\n## Check who gets the change\n\nAvailability may depend on an operating system, a plan, or a gradual rollout. Include those details when you explain who can use a feature today.\n\n## Trace the claim\n\nLink to the original release notes so readers can check compatibility and known issues.',
  },
  {
    ...base, slug: 'what-happens-when-you-open-a-website', section: 'teaching', topic: 'The open web',
    title: 'What happens when you open a website?',
    summary: 'Follow a page from the address bar to your screen through DNS, HTTPS, and the browser.',
    cover_url: '/media/laptop.webp', cover_alt: 'Blue laptop and cable on a pale blue desk',
    video_url: '/media/web-request.mp4', video_captions: '/media/web-request.vtt',
    transcript: 'The browser looks up the domain using DNS, opens a secure connection, requests the page, and renders the response. Cached results can shorten the trip.',
    related_slugs: ['what-an-api-actually-does', 'how-knowledge-stays-connected'],
    sources: [{ title: 'MDN explains how the web works', url: 'https://developer.mozilla.org/en-US/docs/Learn_web_development/Getting_started/Web_standards/How_the_web_works' }],
    body: '## 1. Look up the domain\n\nA browser needs a network address to reach a service. DNS can tell it where to send a request, often with an answer cached by the browser or system.\n\n## 2. Open a connection\n\nFor an HTTPS site, the browser checks the server certificate and uses an encrypted connection.\n\n## 3. Draw the page\n\nThe browser requests HTML and follows references to styles, images, and other resources. It lays out the elements and paints them on the screen.',
  },
  {
    ...base, slug: 'what-an-api-actually-does', section: 'teaching', topic: 'Technology',
    title: 'What does an API actually do?',
    summary: 'A short guide to requests, responses, and the contract that lets two programs work together.',
    cover_url: '/media/rings.webp', cover_alt: 'Silver rings connected by fine wires',
    related_slugs: ['what-happens-when-you-open-a-website'],
    sources: [{ title: 'MDN overview of HTTP', url: 'https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Overview' }],
    body: '## Think in requests and responses\n\nA client sends a request with a method, a path, and sometimes a body. The server replies with a status code and any data it has agreed to return.\n\n## Read the contract first\n\nDocumentation should tell you which fields are required, what the response means, and how errors are represented. Before writing integration code, try one documented request and check what it actually returns.\n\n## Give credentials a purpose\n\nAn agent that submits drafts only needs the permission to create drafts. A separate permission can govern publishing.',
  },
  {
    ...base, slug: 'spot-a-useful-source', section: 'find-out', topic: 'Research',
    title: 'What makes a source useful?',
    summary: 'A practical way to decide whether a link supports the claim you want to make.',
    cover_url: '/media/library.webp', cover_alt: 'Warm light in a curved concrete library',
    related_slugs: ['read-a-technology-release', 'how-knowledge-stays-connected'],
    sources: [{ title: 'Library of Congress guide to primary sources', url: 'https://www.loc.gov/programs/teachers/getting-started-with-primary-sources/' }],
    body: '## Find the original statement\n\nStart with the document, release notes, or study that makes the claim. Check its date and make sure it supports the exact point you want to explain.\n\n## Follow the evidence\n\nCompare the original with a reliable independent explanation when context is missing. Record where the sources disagree or cover different time periods.\n\n## Put the link next to the claim\n\nA reader should be able to follow your reasoning without searching for which source you used.',
  },
];
