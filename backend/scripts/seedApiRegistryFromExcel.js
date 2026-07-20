// Bulk-imports backend/data/api_catalog.xlsx into ApiRegistry as pending
// entries for a human to review. Run manually (see Coolify deploy notes):
//   node scripts/seedApiRegistryFromExcel.js
//
// Every row lands as status: 'pending', proposedBy: 'import', params: [] -
// the spreadsheet's params are free text, not the structured objects the
// schema needs, so a human has to translate them before an entry is safe
// to actually call. Upserts by the generated name, so re-running this
// after fixing a spreadsheet typo is safe and idempotent.
//
// Expected columns on every non-"Summary" sheet (header row 1):
//   Category, Service, Endpoint / Call Name, Base URL, Path, Method,
//   Auth Type, Auth Notes, Key Params, Free Tier / Rate Limit,
//   Reliability Notes, Description, Docs URL, Min Interval (ms)
// "Min Interval (ms)" is optional - a missing column, blank cell, or
// non-numeric value all fall back to the schema's 350ms default rather
// than failing the row.
require('dotenv').config();
const path = require('path');
const XLSX = require('xlsx');
const mongoose = require('mongoose');
const ApiRegistry = require('../src/models/ApiRegistry');

const CATALOG_PATH = path.join(__dirname, '../data/api_catalog_fix.xlsx');

function slugify(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

// "None (optional Bearer for higher limit)" must map to 'none', not
// 'bearer' - checking the "none"-prefix case first (before scanning for
// "bearer" anywhere in the string) is what makes that work. The original
// text - whatever nuance doesn't fit the controlled enum - always survives
// separately in importNotes, so nothing is lost by collapsing it here.
function mapAuthType(raw) {
  const text = String(raw || '').trim().toLowerCase();
  if (text.startsWith('none') || text === 'n/a' || !text) return 'none';
  if (text.includes('bearer')) return 'bearer';
  if (text.includes('header key')) return 'header';
  if (text.includes('query key')) return 'query';
  return 'none';
}

function isDeadOrDeprecated(service, reliabilityNotes) {
  const text = `${service} ${reliabilityNotes}`.toUpperCase();
  return text.includes('DEAD') || text.includes('DEPRECATED');
}

// Falls back to the schema's own default (350) only when the column is
// missing/blank/non-numeric - never for a genuinely-parsed value, even 0.
function parseMinIntervalMs(raw) {
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : 350;
}

// Auth Notes is folded in alongside the three columns named in the spec -
// "Authorization: Bearer <read access token>"-style detail is exactly the
// "nuanced free-text auth description" instruction elsewhere in this
// script is about not losing.
function buildImportNotes({ authNotes, keyParams, freeTier, reliability }) {
  const sections = [];
  if (authNotes?.trim()) sections.push(`Auth: ${authNotes.trim()}`);
  if (keyParams?.trim()) sections.push(`Params: ${keyParams.trim()}`);
  if (freeTier?.trim()) sections.push(`Free tier: ${freeTier.trim()}`);
  if (reliability?.trim()) sections.push(`Reliability: ${reliability.trim()}`);
  return sections.length ? sections.join('\n\n') : null;
}

async function main() {
  if (!process.env.MONGODB_URI) {
    console.error('[import] MONGODB_URI is not set');
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 5000 });
  console.log('[import] connected to Mongo');

  const workbook = XLSX.readFile(CATALOG_PATH);
  const dataSheets = workbook.SheetNames.filter((n) => n.trim().toLowerCase() !== 'summary');

  // Names already used by a hand-curated or AI-approved entry are
  // off-limits to a colliding import slug - re-running this script should
  // only ever upsert over its own previous rows, never a real entry.
  const protectedDocs = await ApiRegistry.find({ proposedBy: { $ne: 'import' } }, 'name').lean();
  const usedNames = new Map(protectedDocs.map((d) => [d.name, 1]));

  let imported = 0;
  let skippedDeadOrDeprecated = 0;
  let skippedInsecureUrl = 0;
  const collisions = [];

  for (const sheetName of dataSheets) {
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: '' });

    for (const row of rows) {
      const service = String(row['Service'] || '').trim();
      const endpoint = String(row['Endpoint / Call Name'] || '').trim();
      if (!service && !endpoint) continue; // blank trailing row

      const path_ = String(row['Path'] || '').trim();
      const reliabilityNotes = String(row['Reliability Notes'] || '').trim();

      if (path_.toUpperCase() === 'N/A' || isDeadOrDeprecated(service, reliabilityNotes)) {
        skippedDeadOrDeprecated++;
        continue;
      }

      const baseUrl = String(row['Base URL'] || '').trim();
      if (!baseUrl.startsWith('https://')) {
        // Same https-only invariant callRegisteredApi() and the admin
        // routes already enforce - importing this as pending would just be
        // an entry nobody can ever approve, so skip it here instead.
        skippedInsecureUrl++;
        continue;
      }

      const baseSlug = slugify(`${service} ${endpoint}`);
      const priorCount = usedNames.get(baseSlug) || 0;
      usedNames.set(baseSlug, priorCount + 1);
      const name = priorCount === 0 ? baseSlug : `${baseSlug}_${priorCount + 1}`;
      if (priorCount > 0) collisions.push(name);

      const rawMethod = String(row['Method'] || '').trim().toUpperCase();
      const method = rawMethod === 'POST' ? 'POST' : 'GET'; // anything else (incl. stray "N/A") defaults to GET

      const entry = {
        name,
        description: String(row['Description'] || '').trim() || `${service} - ${endpoint}`,
        baseUrl,
        path: path_,
        method,
        params: [],
        authType: mapAuthType(row['Auth Type']),
        category: String(row['Category'] || '').trim() || null,
        minIntervalMs: parseMinIntervalMs(row['Min Interval (ms)']),
        importNotes: buildImportNotes({
          authNotes: row['Auth Notes'],
          keyParams: row['Key Params'],
          freeTier: row['Free Tier / Rate Limit'],
          reliability: reliabilityNotes
        }),
        enabled: true,
        status: 'pending',
        proposedBy: 'import'
      };

      await ApiRegistry.updateOne({ name }, { $set: entry }, { upsert: true, setDefaultsOnInsert: true });
      imported++;
    }
  }

  console.log(
    `[import] done - imported ${imported} as pending, skipped ${skippedDeadOrDeprecated} (dead/deprecated), ` +
      `skipped ${skippedInsecureUrl} (insecure http baseUrl)`
  );
  if (collisions.length) {
    console.log(`[import] ${collisions.length} name collision(s) got a numeric suffix - worth a look:`);
    collisions.forEach((n) => console.log(`  - ${n}`));
  } else {
    console.log('[import] no name collisions');
  }

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error('[import] failed:', err);
  process.exit(1);
});
