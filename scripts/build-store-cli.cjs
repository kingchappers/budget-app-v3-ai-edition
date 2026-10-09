const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Compiles the export/import command, the same way build-push-handler.cjs compiles the scheduler.
const outDir = path.join(__dirname, '../build/store-cli');
fs.mkdirSync(outDir, { recursive: true });

console.log('Compiling store CLI...');
execSync(
  'tsc store-cli.ts --outDir build/store-cli --module commonjs --skipLibCheck --strict --target es2020 --resolveJsonModule --esModuleInterop',
  { cwd: path.join(__dirname, '..'), stdio: 'inherit' }
);
// The repo root is "type": "module"; without this nested marker the compiled CommonJS output cannot run from inside the repo.
fs.writeFileSync(path.join(outDir, 'package.json'), JSON.stringify({ type: 'commonjs' }));

console.log('✓ Store CLI compiled to build/store-cli/store-cli.js');
