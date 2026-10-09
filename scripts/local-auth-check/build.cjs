const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Throwaway verification tool: compiles the API handler so server.cjs can drive it. Run with `yarn node` so tsc is on PATH.
const root = path.join(__dirname, '..', '..');
const out = path.join(root, 'build/local-auth-check');
fs.rmSync(out, { recursive: true, force: true });
execSync(
  'tsc api-handler.ts --outDir build/local-auth-check --module commonjs --skipLibCheck --strict --target es2020 --esModuleInterop --resolveJsonModule',
  { cwd: root, stdio: 'inherit' },
);
// The repo root is "type": "module"; this marker lets the compiled CommonJS run from inside the repo.
fs.writeFileSync(path.join(out, 'package.json'), JSON.stringify({ type: 'commonjs' }) + '\n');
console.log('API compiled to build/local-auth-check');
