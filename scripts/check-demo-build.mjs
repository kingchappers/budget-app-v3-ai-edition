// Checks the two SPA builds: the production build must hold no demo code, and the demo build must hold demo code but nothing
// server-only or external. Run as `node scripts/check-demo-build.mjs --production|--demo <dir>`; the functions are exported for tests.
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const MARKER_FILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/demo/marker.ts');
const MARKER_EXTENSIONS = new Set(['.js', '.html', '.css', '.json', '.txt', '.map']);

// Plain substrings. Bare `node:` is matched only as an import specifier (below): UI libraries carry the text in ordinary strings.
const SERVER_ONLY_SUBSTRINGS = ['@aws-sdk', 'aws-sdk', 'node:sqlite', '__vite-browser-external'];
const NODE_IMPORT_SPECIFIER = /(?:from\s*|import\s*\(\s*|require\s*\(\s*)["']node:/;

function listFiles(dir, base = dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...listFiles(full, base));
    else files.push(path.relative(base, full).split(path.sep).join('/'));
  }
  return files;
}

function filesWithExtension(dir, extensions) {
  return listFiles(dir).filter(file => extensions.has(path.extname(file)));
}

export function readMarker(markerSourceText) {
  const match = /export const DEMO_MARKER = '([^']+)'/.exec(markerSourceText);
  if (!match) throw new Error('Could not read DEMO_MARKER from the marker source.');
  return match[1];
}

export function findMarkerFiles(dir, marker) {
  return filesWithExtension(dir, MARKER_EXTENSIONS).filter(file => readFileSync(path.join(dir, file), 'utf8').includes(marker));
}

export function findServerOnlyCode(dir) {
  const found = [];
  for (const file of filesWithExtension(dir, new Set(['.js']))) {
    const text = readFileSync(path.join(dir, file), 'utf8');
    if (NODE_IMPORT_SPECIFIER.test(text)) found.push(`${file}: node:`);
    for (const pattern of SERVER_ONLY_SUBSTRINGS) {
      if (text.includes(pattern)) found.push(`${file}: ${pattern}`);
    }
  }
  return found;
}

const isExternal = url => /^(?:https?:)?\/\//i.test(url);

export function findExternalReferences(dir) {
  const found = [];
  for (const file of filesWithExtension(dir, new Set(['.html']))) {
    const text = readFileSync(path.join(dir, file), 'utf8');
    for (const match of text.matchAll(/\b(?:src|href)\s*=\s*["']([^"']*)["']/gi)) {
      if (isExternal(match[1].trim())) found.push(`${file}: ${match[1].trim()}`);
    }
  }
  for (const file of filesWithExtension(dir, new Set(['.css']))) {
    const text = readFileSync(path.join(dir, file), 'utf8');
    for (const match of text.matchAll(/url\(\s*["']?([^"')]*)["']?\s*\)/gi)) {
      if (isExternal(match[1].trim())) found.push(`${file}: ${match[1].trim()}`);
    }
  }
  return found;
}

export function inlineScriptHashes(html) {
  const hashes = [];
  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (/\bsrc\s*=/i.test(match[1])) continue;
    hashes.push(`sha256-${createHash('sha256').update(match[2]).digest('base64')}`);
  }
  return hashes;
}

export function buildCspHeader(hashes) {
  const scriptSrc = ["'self'", ...hashes.map(hash => `'${hash}'`)].join(' ');
  return [
    "default-src 'self'",
    `script-src ${scriptSrc}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
}

function checkProduction(dir) {
  const marker = readMarker(readFileSync(MARKER_FILE, 'utf8'));
  const files = findMarkerFiles(dir, marker);
  if (files.length > 0) {
    console.error(`FAIL  demo code found in the production build ${dir}:\n  ${files.join('\n  ')}`);
    return false;
  }
  console.log(`PASS  no demo code in ${dir}`);
  return true;
}

function checkDemo(dir) {
  const marker = readMarker(readFileSync(MARKER_FILE, 'utf8'));
  if (findMarkerFiles(dir, marker).length === 0) {
    console.error(`FAIL  the demo marker is missing from ${dir}: the demo code is not in the build, or this check cannot see it`);
    return false;
  }
  console.log(`PASS  demo code is present in ${dir}`);

  const serverOnly = findServerOnlyCode(dir);
  const external = findExternalReferences(dir);
  if (serverOnly.length > 0 || external.length > 0) {
    console.error(`FAIL  the demo build must be self-contained:\n  ${[...serverOnly, ...external].join('\n  ')}`);
    return false;
  }
  console.log('PASS  no server-only code and no external references');

  const hashes = inlineScriptHashes(readFileSync(path.join(dir, 'index.html'), 'utf8'));
  const headerFile = path.join(dir, '..', 'csp-header.txt');
  writeFileSync(headerFile, `${buildCspHeader(hashes)}\n`);
  console.log(`PASS  wrote ${path.relative(process.cwd(), headerFile)} with ${hashes.length} inline script hash(es)`);
  return true;
}

function main(args) {
  const [mode, dir] = args;
  if (!dir || (mode !== '--production' && mode !== '--demo')) {
    console.error('Usage: node scripts/check-demo-build.mjs --production|--demo <build-dir>');
    return 2;
  }
  const ok = mode === '--production' ? checkProduction(dir) : checkDemo(dir);
  return ok ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main(process.argv.slice(2)));
}
