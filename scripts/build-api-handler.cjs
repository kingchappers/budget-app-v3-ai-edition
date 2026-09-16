const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const root = path.join(__dirname, '..');

const LAMBDAS = [
  {
    entry: 'api-handler.ts',
    outDir: 'build/api',
    dependencies: {
      'jsonwebtoken': '^9.0.3',
      'jwks-rsa': '^3.2.1',
      '@aws-sdk/client-dynamodb': '^3.0.0',
      '@aws-sdk/lib-dynamodb': '^3.0.0',
    },
  },
  {
    entry: 'sync-handler.ts',
    outDir: 'build/sync',
    dependencies: {
      '@aws-sdk/client-dynamodb': '^3.0.0',
      '@aws-sdk/lib-dynamodb': '^3.0.0',
      '@aws-sdk/client-secrets-manager': '^3.0.0',
    },
  },
];

function buildLambda({ entry, outDir, dependencies }) {
  const buildDir = path.join(root, outDir);
  fs.mkdirSync(buildDir, { recursive: true });

  console.log(`Compiling ${entry}...`);
  execSync(
    `tsc ${entry} --outDir ${outDir} --module commonjs --skipLibCheck --strict --target es2020 --resolveJsonModule --esModuleInterop`,
    { cwd: root, stdio: 'inherit' },
  );

  // Lambda's handler is "index.handler"
  const compiled = path.join(buildDir, entry.replace(/\.ts$/, '.js'));
  if (fs.existsSync(compiled)) {
    fs.renameSync(compiled, path.join(buildDir, 'index.js'));
  }

  const packageJsonPath = path.join(buildDir, 'package.json');
  fs.writeFileSync(packageJsonPath, JSON.stringify({ name: `budget-app-${path.basename(outDir)}`, version: '1.0.0', dependencies }, null, 2));

  console.log(`Installing dependencies for ${outDir}...`);
  execSync('npm install --production', { cwd: buildDir, stdio: 'inherit' });

  fs.unlinkSync(packageJsonPath);
  const lockFilePath = path.join(buildDir, 'package-lock.json');
  if (fs.existsSync(lockFilePath)) fs.unlinkSync(lockFilePath);

  console.log(`✓ ${entry} compiled to ${outDir}/index.js`);
}

LAMBDAS.forEach(buildLambda);
