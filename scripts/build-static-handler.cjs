const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const root = path.join(__dirname, '..');
const tmpDir = path.join(root, 'build/static-handler');
const target = path.join(root, 'build/client/index.js');

fs.rmSync(tmpDir, { recursive: true, force: true });

console.log('Compiling static handler...');
execSync(
  'tsc src/static/handler.ts --outDir build/static-handler --module commonjs --skipLibCheck --strict --target es2020 --esModuleInterop',
  { cwd: root, stdio: 'inherit' }
);

// Lambda loads build/client/index.js, so the compiled single file replaces it.
fs.copyFileSync(path.join(tmpDir, 'handler.js'), target);
fs.rmSync(tmpDir, { recursive: true, force: true });

console.log('✓ Static handler compiled to build/client/index.js');
