#!/usr/bin/env node
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const repoRoot = process.cwd();
const pkgPath = path.join(repoRoot, 'package.json');
const chromeManifestPath = path.join(repoRoot, 'manifest.chrome.json');
const firefoxManifestPath = path.join(repoRoot, 'manifest.firefox.json');
const distDir = path.join(repoRoot, 'dist');
const updatesJsonPath = path.join(distDir, 'updates.json');

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function writeJson(p, obj) {
  fs.writeFileSync(p, JSON.stringify(obj, null, 2) + '\n', 'utf8');
}

function isSemver(v) {
  return /^\d+\.\d+\.\d+$/.test(v);
}

function bumpSemver(v, bump) {
  const parts = String(v).split('.').map((n) => parseInt(n, 10) || 0);
  let [maj, min, pat] = parts.length === 3 ? parts : [0, 0, 0];
  if (bump === 'major') { maj += 1; min = 0; pat = 0; }
  else if (bump === 'minor') { min += 1; pat = 0; }
  else { pat += 1; }
  return `${maj}.${min}.${pat}`;
}

function parseArgs(argv) {
  const out = { version: null, bump: null, noBuild: false, noPack: false };
  for (const a of argv.slice(2)) {
    if (a.startsWith('--version=')) out.version = a.split('=')[1];
    else if (a === '--version') out.version = argv[argv.indexOf(a) + 1];
    else if (a.startsWith('--bump=')) out.bump = a.split('=')[1];
    else if (a === '--bump') out.bump = argv[argv.indexOf(a) + 1];
    else if (a === '--no-build') out.noBuild = true;
    else if (a === '--no-pack') out.noPack = true;
  }
  return out;
}

function run(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, { stdio: 'inherit', cwd: repoRoot, ...opts });
  if (res.status !== 0) {
    throw new Error(`Command failed: ${cmd} ${args.join(' ')}`);
  }
}

async function ensureDir(p) {
  await fsp.mkdir(p, { recursive: true });
}

async function main() {
  const args = parseArgs(process.argv);
  const pkg = readJson(pkgPath);
  const current = pkg.version;

  let next = args.version;
  if (!next) {
    const bump = (args.bump || 'patch').toLowerCase();
    if (!['major', 'minor', 'patch'].includes(bump)) {
      throw new Error(`Unknown bump type: ${bump}`);
    }
    next = bumpSemver(current, bump);
  }
  if (!isSemver(next)) {
    throw new Error(`Invalid version: ${next}. Use x.y.z or --bump {major|minor|patch}`);
  }

  // Update package.json
  pkg.version = next;
  writeJson(pkgPath, pkg);

  // Update manifests
  const chromeMf = readJson(chromeManifestPath);
  chromeMf.version = next;
  writeJson(chromeManifestPath, chromeMf);

  const ffMf = readJson(firefoxManifestPath);
  ffMf.version = next;
  writeJson(firefoxManifestPath, ffMf);

  // Build and pack unless skipped
  if (!args.noBuild) {
    run('npm', ['run', 'build']);
  }
  if (!args.noPack) {
    run('npm', ['run', 'pack:chrome']);
    // web-ext builds a .zip; some hosts prefer .xpi. We'll copy if needed.
    run('npm', ['run', 'pack:firefox']);
    const expectedZip = path.join(distDir, `${pkg.name}-${next}.zip`);
    const expectedXpi = path.join(distDir, `${pkg.name}-${next}.xpi`);
    try {
      if (fs.existsSync(expectedZip) && !fs.existsSync(expectedXpi)) {
        fs.copyFileSync(expectedZip, expectedXpi);
        console.log(`Created XPI copy: ${path.relative(repoRoot, expectedXpi)}`);
      }
    } catch (_) {
      // non-fatal
    }
  }

  // Update dist/updates.json for self-hosted Firefox updates
  await ensureDir(distDir);
  const gecko = ffMf?.browser_specific_settings?.gecko || {};
  const addonId = gecko.id || 'your-addon-id@example';
  const strictMin = gecko.strict_min_version || '109.0';
  const updateURL = gecko.update_url || '';
  const baseForXpi = updateURL.includes('updates.json')
    ? updateURL.slice(0, updateURL.lastIndexOf('/'))
    : (updateURL || '');

  const updates = fs.existsSync(updatesJsonPath)
    ? readJson(updatesJsonPath)
    : { addons: { [addonId]: { updates: [] } } };

  // Ensure structure exists
  if (!updates.addons) updates.addons = {};
  if (!updates.addons[addonId]) updates.addons[addonId] = { updates: [] };
  if (!Array.isArray(updates.addons[addonId].updates)) updates.addons[addonId].updates = [];

  // Remove existing same-version entry if present
  updates.addons[addonId].updates = updates.addons[addonId].updates.filter((u) => u.version !== next);

  const xpiName = `${pkg.name}-${next}.xpi`;
  const updateLink = baseForXpi
    ? `${baseForXpi}/${xpiName}`
    : `https://raw.githubusercontent.com/OWNER/REPO/BRANCH/dist/${xpiName}`;

  updates.addons[addonId].updates.push({
    version: next,
    update_link: updateLink,
    applications: { gecko: { strict_min_version: strictMin } },
  });

  writeJson(updatesJsonPath, updates);

  console.log('\nRelease prepared. Summary:');
  console.log(`- Version: ${current} -> ${next}`);
  console.log(`- Updated: package.json, manifest.chrome.json, manifest.firefox.json`);
  if (!args.noBuild) console.log(`- Built: build/chrome, build/firefox`);
  if (!args.noPack) console.log(`- Packed: dist/chrome.zip, dist/(zip|xpi)`);
  console.log(`- updates.json: ${path.relative(repoRoot, updatesJsonPath)}`);
  console.log('\nNext steps:');
  console.log('- Commit changes, tag, and push artifacts as needed.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

