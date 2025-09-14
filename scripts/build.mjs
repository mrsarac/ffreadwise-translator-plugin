#!/usr/bin/env node
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

const repoRoot = process.cwd();
const buildRoot = path.join(repoRoot, 'build');

const IGNORES = new Set([
  'build',
  'dist',
  'node_modules',
  '.git',
  '.DS_Store',
  '.bmad-core',
  '.idea',
  '.vscode',
  'scripts', // copied separately as needed
  'manifest.json', // root manifest is legacy; we copy per-target manifests
  'manifest.chrome.json',
  'manifest.firefox.json',
]);

const TARGETS = {
  chrome: {
    manifestFile: 'manifest.chrome.json',
  },
  firefox: {
    manifestFile: 'manifest.firefox.json',
  },
};

function isDir(p) {
  try { return fs.statSync(p).isDirectory(); } catch { return false; }
}

async function rimraf(dir) {
  await fsp.rm(dir, { recursive: true, force: true });
}

async function mkdirp(dir) {
  await fsp.mkdir(dir, { recursive: true });
}

async function copyFile(src, dest) {
  await mkdirp(path.dirname(dest));
  await fsp.copyFile(src, dest);
}

async function copyDir(src, dest, filter) {
  await mkdirp(dest);
  const entries = await fsp.readdir(src, { withFileTypes: true });
  for (const e of entries) {
    const name = e.name;
    if (IGNORES.has(name)) continue;
    const s = path.join(src, name);
    const d = path.join(dest, name);
    if (filter && !(await filter(s, e))) continue;
    if (e.isDirectory()) {
      await copyDir(s, d, filter);
    } else if (e.isFile()) {
      await copyFile(s, d);
    }
  }
}

async function buildTarget(target) {
  if (!TARGETS[target]) throw new Error(`Unknown target: ${target}`);
  const outDir = path.join(buildRoot, target);
  await rimraf(outDir);
  await mkdirp(outDir);

  // Copy source files (excluding ignored)
  await copyDir(repoRoot, outDir);

  // Drop any accidental top-level package.json-like non-extension fields? Not necessary

  // Inject manifest
  const mfSrc = path.join(repoRoot, TARGETS[target].manifestFile);
  const mfDest = path.join(outDir, 'manifest.json');
  const manifestRaw = await fsp.readFile(mfSrc, 'utf8');
  await fsp.writeFile(mfDest, manifestRaw);

  // Small log helpers
  const { name, version, manifest_version } = JSON.parse(manifestRaw);
  console.log(`Built ${target}: ${name} v${version} (MV${manifest_version}) -> ${path.relative(repoRoot, outDir)}`);
}

async function main() {
  const arg = process.argv[2]?.toLowerCase();
  const doAll = !arg || arg === 'all';
  if (doAll || arg === 'chrome') await buildTarget('chrome');
  if (doAll || arg === 'firefox') await buildTarget('firefox');
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

