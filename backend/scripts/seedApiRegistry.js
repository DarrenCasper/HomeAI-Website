// One-off seed for the built-in API registry entries. Not run on normal
// startup - run manually: node scripts/seedApiRegistry.js
// Upserts by name, so re-running after editing this file (or after a
// human tweaks one of these rows in the admin UI and wants the baseline
// restored) is safe.
require('dotenv').config();
const mongoose = require('mongoose');
const ApiRegistry = require('../src/models/ApiRegistry');

const ENTRIES = [
  {
    name: 'jikan_anime_search',
    description: 'Search for anime by title (MyAnimeList data via the unofficial Jikan API) - titles, synopses, scores, episode counts.',
    baseUrl: 'https://api.jikan.moe/v4',
    path: '/anime',
    params: [{ name: 'q', in: 'query', required: true, description: 'Anime title to search for' }],
    authType: 'none'
  },
  {
    name: 'brave_web_search',
    description: 'General-purpose live web search - use for current events or anything not covered by a more specific tool.',
    baseUrl: 'https://api.search.brave.com',
    path: '/res/v1/web/search',
    params: [
      { name: 'q', in: 'query', required: true, description: 'Search query' },
      { name: 'count', in: 'query', required: false, description: 'Number of results to return' }
    ],
    authType: 'header',
    authKeyName: 'X-Subscription-Token',
    authEnvVar: 'BRAVE_API_KEY'
  },
  {
    name: 'currency_convert',
    description: 'Current currency exchange rates between one base currency and one or more target currencies.',
    baseUrl: 'https://api.frankfurter.dev',
    path: '/v1/latest',
    params: [
      { name: 'base', in: 'query', required: true, description: 'Base currency code, e.g. USD' },
      { name: 'symbols', in: 'query', required: true, description: 'Comma-separated target currency codes, e.g. EUR,GBP' }
    ],
    authType: 'none'
  },
  {
    name: 'crypto_price',
    description: 'Current price of one or more cryptocurrencies in one or more fiat/crypto currencies.',
    baseUrl: 'https://api.coingecko.com',
    path: '/api/v3/simple/price',
    params: [
      { name: 'ids', in: 'query', required: true, description: 'Comma-separated CoinGecko coin ids, e.g. bitcoin,ethereum' },
      { name: 'vs_currencies', in: 'query', required: true, description: 'Comma-separated currency codes, e.g. usd,eur' }
    ],
    authType: 'none'
  },
  {
    name: 'wiki_summary',
    description: 'Short summary of a Wikipedia article for a given topic.',
    baseUrl: 'https://en.wikipedia.org',
    path: '/api/rest_v1/page/summary/{topic}',
    params: [{ name: 'topic', in: 'path', required: true, description: 'Wikipedia article title' }],
    authType: 'none'
  }

  // ip_geolocation intentionally omitted: its free tier is http-only
  // (http://ip-api.com), which fails lib/apiRegistry.js's https-only
  // enforcement on every call - not worth carving out an exception to a
  // security invariant that otherwise applies to every registered API,
  // for one geolocation lookup.
];

async function main() {
  if (!process.env.MONGODB_URI) {
    console.error('[seed] MONGODB_URI is not set');
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 5000 });
  console.log('[seed] connected to Mongo');

  for (const entry of ENTRIES) {
    await ApiRegistry.updateOne(
      { name: entry.name },
      {
        $set: { ...entry, method: 'GET', enabled: true, status: 'approved', proposedBy: 'user' }
      },
      { upsert: true, setDefaultsOnInsert: true }
    );
    console.log(`[seed] upserted ${entry.name}`);
  }

  await mongoose.disconnect();
  console.log(`[seed] done - ${ENTRIES.length} entries`);
}

main().catch((err) => {
  console.error('[seed] failed:', err);
  process.exit(1);
});
