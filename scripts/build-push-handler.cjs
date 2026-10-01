const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Builds the bill-reminder scheduler Lambda, the same way build-api-handler.cjs builds the API.
const pushBuildDir = path.join(__dirname, '../build/push');
if (!fs.existsSync(pushBuildDir)) {
  fs.mkdirSync(pushBuildDir, { recursive: true });
}

console.log('Compiling push scheduler handler...');
execSync(
  'tsc push-handler.ts --outDir build/push --module commonjs --skipLibCheck --strict --target es2020 --resolveJsonModule --esModuleInterop',
  { cwd: path.join(__dirname, '..'), stdio: 'inherit' }
);

// Lambda finds the handler as "index.handler".
const compiledPath = path.join(pushBuildDir, 'push-handler.js');
const indexPath = path.join(pushBuildDir, 'index.js');
if (fs.existsSync(compiledPath)) {
  fs.renameSync(compiledPath, indexPath);
}

const packageJsonPath = path.join(pushBuildDir, 'package.json');
fs.writeFileSync(packageJsonPath, JSON.stringify({
  name: 'budget-app-push',
  version: '1.0.0',
  dependencies: {
    'web-push': '^3.6.7',
    '@aws-sdk/client-dynamodb': '^3.0.0',
    '@aws-sdk/lib-dynamodb': '^3.0.0',
    '@aws-sdk/client-ssm': '^3.0.0',
  },
}, null, 2));

console.log('Installing Lambda dependencies...');
execSync('npm install --production', { cwd: pushBuildDir, stdio: 'inherit' });

fs.unlinkSync(packageJsonPath);
const lockFilePath = path.join(pushBuildDir, 'package-lock.json');
if (fs.existsSync(lockFilePath)) {
  fs.unlinkSync(lockFilePath);
}

console.log('✓ Push scheduler compiled to build/push/index.js');
console.log('✓ Dependencies installed to build/push/node_modules/');
