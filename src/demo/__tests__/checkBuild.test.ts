import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DEMO_MARKER } from '../marker';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildCspHeader,
  findExternalReferences,
  findMarkerFiles,
  findServerOnlyCode,
  inlineScriptHashes,
  readMarker,
} from '../../../scripts/check-demo-build.mjs';

const dirs: string[] = [];

function fixture(files: Record<string, string>): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'demo-check-'));
  dirs.push(dir);
  for (const [name, content] of Object.entries(files)) {
    const file = path.join(dir, name);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, content);
  }
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('readMarker', () => {
  it('extracts the marker string', () => {
    expect(readMarker("// note\nexport const DEMO_MARKER = 'abc-123';\n")).toBe('abc-123');
  });

  it('throws when the constant is missing', () => {
    expect(() => readMarker('export const OTHER = 1;')).toThrow();
  });
});

describe('findMarkerFiles', () => {
  it('finds the marker in js and html files, nested', () => {
    const dir = fixture({
      'assets/app.js': 'var a="MARK-1";',
      'index.html': '<p>MARK-1</p>',
      'assets/other.js': 'var b=1;',
    });
    expect(findMarkerFiles(dir, 'MARK-1').sort()).toEqual(['assets/app.js', 'index.html']);
  });

  it('returns nothing for a clean directory', () => {
    expect(findMarkerFiles(fixture({ 'a.js': 'var a=1;' }), 'MARK-1')).toEqual([]);
  });

  it('ignores file types it does not scan', () => {
    expect(findMarkerFiles(fixture({ 'a.png': 'MARK-1' }), 'MARK-1')).toEqual([]);
  });
});

describe('findServerOnlyCode', () => {
  it.each([
    ['import{x}from"node:fs";', 'node:'],
    ["import x from'node:path';", 'node:'],
    ['const m=await import("node:crypto");', 'node:'],
    ['const m=require("node:os");', 'node:'],
    ['import"node:fs";', 'node:'],
    ['import "node:fs";', 'node:'],
    ['const m=await import(`node:fs`);', 'node:'],
    ['var a="@aws-sdk/client-dynamodb";', '@aws-sdk'],
    ['var a="aws-sdk";', 'aws-sdk'],
    ['var a="node:sqlite";', 'node:sqlite'],
    ['var a="__vite-browser-external";', '__vite-browser-external'],
  ])('flags %s', (source, pattern) => {
    const found = findServerOnlyCode(fixture({ 'x.js': source }));
    expect(found.some(entry => entry.startsWith('x.js: ') && entry.includes(pattern))).toBe(true);
  });

  it('passes clean code, including a plain node: string in UI code', () => {
    expect(findServerOnlyCode(fixture({ 'x.js': 'var a="node:"; var b="note:node: list";' }))).toEqual([]);
  });

  it('passes object keys that look like node: specifiers', () => {
    expect(findServerOnlyCode(fixture({ 'x.js': 'var t={"node:":1,import:"x",from:{"node:a":2}};' }))).toEqual([]);
  });
});

describe('findExternalReferences', () => {
  it.each([
    ['index.html', '<script src="https://cdn.example/x.js"></script>'],
    ['index.html', '<link href="//cdn.example/x.css">'],
    ['index.html', '<img src="http://example.com/a.png">'],
    ['a.css', 'a{background:url(http://example.com/a.png)}'],
    ['a.css', 'a{background:url("https://example.com/a.png")}'],
  ])('flags %s with %s', (name, content) => {
    const found = findExternalReferences(fixture({ [name]: content }));
    expect(found).toHaveLength(1);
    expect(found[0].startsWith(`${name}: `)).toBe(true);
  });

  it('passes relative and absolute-path references', () => {
    const dir = fixture({
      'index.html': '<script src="/assets/a.js"></script><link href="assets/a.css"><a href="#x">x</a>',
      'a.css': 'a{background:url(/img/a.png)} b{background:url("data:image/png;base64,AAA")}',
    });
    expect(findExternalReferences(dir)).toEqual([]);
  });
});

describe('inlineScriptHashes', () => {
  it('hashes the exact body and ignores external scripts', () => {
    const body = 'window.__x = 1;\n';
    const html = `<script src="/a.js"></script><script>${body}</script>`;
    const expected = `sha256-${createHash('sha256').update(body).digest('base64')}`;
    expect(inlineScriptHashes(html)).toEqual([expected]);
  });
});

describe('buildCspHeader', () => {
  it('lists each hash once and keeps unsafe-inline out of script-src', () => {
    const header = buildCspHeader(['sha256-AAA', 'sha256-BBB']);
    expect(header.split("'sha256-AAA'")).toHaveLength(2);
    expect(header.split("'sha256-BBB'")).toHaveLength(2);
    const scriptSrc = header.split('; ').find(part => part.startsWith('script-src')) ?? '';
    expect(scriptSrc).not.toContain("'unsafe-inline'");
    expect(header).toContain("default-src 'self'");
    expect(header).toContain("frame-ancestors 'none'");
  });
});

describe('check-demo-build CLI', () => {
  const script = path.resolve(__dirname, '../../../scripts/check-demo-build.mjs');
  const run = (mode: string, dir: string) => spawnSync(process.execPath, [script, mode, dir], { encoding: 'utf8' });
  const page = '<html><body><script>window.a=1</script></body></html>';

  it('--production fails when the demo marker is present', () => {
    const dir = fixture({ 'index.html': page, 'assets/app.js': `var m="${DEMO_MARKER}";` });
    expect(run('--production', dir).status).toBe(1);
  });

  it('--production passes a build without the marker', () => {
    expect(run('--production', fixture({ 'index.html': page, 'assets/app.js': 'var a=1;' })).status).toBe(0);
  });

  it('--demo fails when the marker is absent', () => {
    expect(run('--demo', fixture({ 'index.html': page, 'assets/app.js': 'var a=1;' })).status).toBe(1);
  });

  it('--demo fails on server-only code even with the marker present', () => {
    const dir = fixture({ 'index.html': page, 'assets/app.js': `var m="${DEMO_MARKER}";import"node:fs";` });
    expect(run('--demo', dir).status).toBe(1);
  });

  it('--demo passes a clean demo build and writes the CSP header beside it', () => {
    const root = fixture({ 'client/index.html': page, 'client/assets/app.js': `var m="${DEMO_MARKER}";` });
    expect(run('--demo', path.join(root, 'client')).status).toBe(0);
    expect(readFileSync(path.join(root, 'csp-header.txt'), 'utf8')).toContain("script-src 'self' 'sha256-");
  });
});
