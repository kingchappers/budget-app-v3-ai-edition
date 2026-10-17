// Builds the browser demo into build/demo/. The dummy Auth0 values only let the build run: the demo never talks to Auth0, and this
// script refuses to run with real values in the environment so a real tenant can never end up in the demo bundle.
const { spawnSync } = require('node:child_process');

const DUMMY = {
  VITE_AUTH0_DOMAIN: 'demo.invalid',
  VITE_AUTH0_CLIENT_ID: 'dummy',
  VITE_AUTH0_AUDIENCE: 'https://demo.invalid/api',
};

for (const [name, value] of Object.entries(DUMMY)) {
  const present = process.env[name];
  if (present && present !== value) {
    console.error(`${name} is set to a different value in this shell. Unset it: the demo build must not use a real tenant.`);
    process.exit(1);
  }
}

const result = spawnSync('yarn', ['react-router', 'build'], {
  stdio: 'inherit',
  env: { ...process.env, ...DUMMY, VITE_DEMO: 'true', BUILD_DIR: 'build/demo' },
});
process.exit(result.status ?? 1);
