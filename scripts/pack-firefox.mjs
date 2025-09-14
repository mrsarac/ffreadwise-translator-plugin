#!/usr/bin/env node
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const repoRoot = process.cwd();
const buildDir = path.join(repoRoot, 'build', 'firefox');
const distDir = path.join(repoRoot, 'dist');
const pkgPath = path.join(repoRoot, 'package.json');
const ffManifestPath = path.join(repoRoot, 'manifest.firefox.json');

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

async function ensureDir(p) {
  await fsp.mkdir(p, { recursive: true });
}

function runZip(cwd, outFile) {
  const res = spawnSync('zip', ['-qr', outFile, '.'], { cwd, stdio: 'inherit' });
  if (res.status !== 0) {
    throw new Error('zip command failed. Ensure `zip` CLI is installed.');
  }
}

async function main() {
  if (!fs.existsSync(buildDir)) {
    console.error('Missing build/firefox. Run `npm run build:firefox` first.');
    process.exit(1);
  }

  const pkg = readJson(pkgPath);
  const ffManifest = readJson(ffManifestPath);
  // Prefer package.json version, fallback to manifest if needed
  const version = pkg.version || ffManifest.version || '0.0.0';

  await ensureDir(distDir);
  const outName = `${pkg.name}-${version}.xpi`;
  const outPath = path.join(distDir, outName);

  try { fs.unlinkSync(outPath); } catch {}
  console.log(`Packing Firefox XPI → dist/${outName}`);
  runZip(buildDir, outPath);
  console.log(`Done: ${path.relative(repoRoot, outPath)}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

