// Usage: node scripts/container-smoke.mjs <image> [--tls|--proxy]
// Runs the image with throwaway volumes and checks the whole path over HTTP(S). Needs a running Docker daemon.
// Prints one PASS/FAIL line per step and exits non-zero on the first failure. Node built-ins only.
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import http from 'node:http';
import https from 'node:https';
import { createServer } from 'node:net';

const [image, ...flags] = process.argv.slice(2);
if (!image) throw new Error('Usage: node scripts/container-smoke.mjs <image> [--tls|--proxy]');
const tls = flags.includes('--tls');
const proxy = flags.includes('--proxy');
if (tls && proxy) throw new Error('Use either --tls or --proxy, not both');
// A made-up public name: the container only ever sees it in headers, so nothing here touches the network.
const PROXY_ORIGIN = 'https://budget.example.test';
const PROXY_CLIENT_IP = '203.0.113.7';

const docker = (...args) => {
  const result = spawnSync('docker', args, { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`docker ${args.join(' ')} failed: ${result.stderr || result.stdout}`);
  return result.stdout.trim();
};

// docker logs replays the container's stdout on stdout and its stderr on stderr.
const dockerLogs = (...extra) => {
  const result = spawnSync('docker', ['logs', ...extra, name], { encoding: 'utf8' });
  return `${result.stdout}\n${result.stderr}`;
};

// The newest "Setup code:" / "Recovery code:" line in the log (the boxed block prints it on a line of its own).
const lastCode = () => [...dockerLogs().matchAll(/^(?:Setup|Recovery) code: (\S+)$/gm)].map(match => match[1]).at(-1);

const freePort = () => new Promise((resolve, reject) => {
  const server = createServer();
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => {
    const { port } = server.address();
    server.close(() => resolve(port));
  });
});

// Caddy's internal root certificate, read out of the container, so the HTTPS checks verify the certificate chain
// (and the name "localhost") instead of skipping verification.
let caCertificate;
// Where Caddy keeps its internal root: under its storage directory (DATA_DIR/caddy), found with `find /data -name root.crt`.
const CADDY_ROOT = '/data/caddy/pki/authorities/local/root.crt';

// base is "http(s)://host:port"; path is sent verbatim (so odd spellings such as "//config.json" reach the server unchanged).
const request = (base, path, { method = 'GET', headers = {}, body } = {}) => new Promise((resolve, reject) => {
  const target = new URL(base);
  const secure = target.protocol === 'https:';
  const lib = secure ? https : http;
  const req = lib.request({
    host: target.hostname, port: target.port, path, method, headers,
    ...(secure ? { servername: 'localhost', ca: caCertificate } : {}),
  }, res => {
    const chunks = [];
    res.on('data', chunk => chunks.push(chunk));
    res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
  });
  req.setTimeout(30_000, () => req.destroy(new Error('timeout')));
  req.on('error', reject);
  if (body) req.write(body);
  req.end();
});

const step = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `  ${detail}`}`);
  if (!ok) throw new Error(`Step failed: ${label}`);
};

async function waitFor(check, what, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    try {
      const result = await check();
      if (result) return result;
    } catch (error) {
      last = error;
    }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  throw new Error(`Timed out waiting for ${what}${last ? `: ${last.message}` : ''}`);
}

const suffix = randomBytes(4).toString('hex');
const name = `budget-smoke-${suffix}`;
const volume = `budget-smoke-data-${suffix}`;
const backupVolume = `budget-smoke-backups-${suffix}`;

function cleanup() {
  spawnSync('docker', ['rm', '-f', name]);
  spawnSync('docker', ['volume', 'rm', '-f', volume, backupVolume]);
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    console.error(`Interrupted (${signal}): cleaning up`);
    cleanup();
    process.exit(130);
  });
}

async function main() {
  docker('volume', 'create', volume);
  docker('volume', 'create', backupVolume);

  // Fresh named volumes at /data and /data/backups, exactly as compose.example.yml mounts them.
  const mounts = ['-v', `${volume}:/data`, '-v', `${backupVolume}:/data/backups`];
  let base;
  let publicOrigin;
  let http80;
  if (tls) {
    const https443 = await freePort();
    http80 = await freePort();
    publicOrigin = `https://localhost:${https443}`;
    // Docker lets containers bind low ports by default; raising the limit makes Caddy depend on its setcap file capability.
    docker('run', '-d', '--name', name, ...mounts, '--sysctl', 'net.ipv4.ip_unprivileged_port_start=1024', '-p', `127.0.0.1:${https443}:443`, '-p', `127.0.0.1:${http80}:80`,
      '-e', 'TLS_DOMAIN=localhost', '-e', `APP_ORIGIN=${publicOrigin}`, image);
    base = `https://127.0.0.1:${https443}`;
  } else if (proxy) {
    const port = await freePort();
    publicOrigin = PROXY_ORIGIN;
    // Plain HTTP inside the container, as behind a managed host's proxy: forwarded headers trusted, public origin https.
    docker('run', '-d', '--name', name, ...mounts, '-p', `127.0.0.1:${port}:8080`, '-e', 'TRUST_PROXY=true', '-e', `APP_ORIGIN=${publicOrigin}`, image);
    base = `http://127.0.0.1:${port}`;
  } else {
    const port = await freePort();
    publicOrigin = `http://127.0.0.1:${port}`;
    docker('run', '-d', '--name', name, ...mounts, '-p', `127.0.0.1:${port}:8080`, '-e', `APP_ORIGIN=${publicOrigin}`, image);
    base = publicOrigin;
  }
  const hostHeader = tls || proxy ? { Host: new URL(publicOrigin).host } : {};
  const forwarded = proxy ? { 'X-Forwarded-Proto': 'https', 'X-Forwarded-For': PROXY_CLIENT_IP } : {};

  const get = (path, extra = {}) => request(base, path, { headers: { ...hostHeader, ...forwarded, ...extra } });
  const post = (path, payload, extra = {}) => request(base, path, {
    method: 'POST', body: JSON.stringify(payload),
    headers: { ...hostHeader, ...forwarded, 'Content-Type': 'application/json', Origin: publicOrigin, ...extra },
  });

  if (tls) {
    caCertificate = await waitFor(() => {
      const pem = docker('exec', name, 'cat', CADDY_ROOT);
      return pem.includes('BEGIN CERTIFICATE') ? pem : undefined;
    }, "Caddy's internal root certificate");
    step("Caddy's internal root certificate is available (verification stays on)", true);
  }

  await waitFor(async () => (await get('/healthz')).status === 200, '/healthz');
  step('healthz is 200', true);

  for (const path of ['/config.json', '//config.json', '/%63onfig.json']) {
    const config = await get(path);
    let auth;
    try { auth = JSON.parse(config.body).auth; } catch { auth = undefined; }
    step(`${path} is the local config, not the Auth0 one`, config.status === 200 && auth === 'local', `${config.status} ${config.body}`);
  }

  const status = await get('/api/auth/status');
  step('setup is required on a fresh volume', JSON.parse(status.body).setupRequired === true, status.body);

  const uid = docker('exec', name, 'id', '-u');
  const gid = docker('exec', name, 'id', '-g');
  step('runs as uid 10001 and gid 10001', uid === '10001' && gid === '10001', `${uid}:${gid}`);
  const noModules = spawnSync('docker', ['exec', name, 'test', '-e', '/app/node_modules']);
  step('/app/node_modules does not exist in the image', noModules.status !== 0);
  const strayConfig = spawnSync('docker', ['exec', name, 'test', '-e', '/app/build/client/config.json']);
  step('no built config.json in build/client', strayConfig.status !== 0);

  const dataOwner = docker('exec', name, 'stat', '-c', '%u', '/data');
  const backupOwner = docker('exec', name, 'stat', '-c', '%u', '/data/backups');
  step('/data and the fresh /data/backups volume are owned by uid 10001', dataOwner === '10001' && backupOwner === '10001', `${dataOwner} ${backupOwner}`);
  const listing = await waitFor(() => {
    const out = docker('exec', name, 'ls', '/data/backups');
    return /^budget-\d{8}-\d{6}\.sqlite$/m.test(out) ? out : undefined;
  }, 'the start-up backup', 30_000);
  step('the start-up backup exists on the backups volume', true, listing);
  const backupFile = `/data/backups/${listing.match(/^budget-\d{8}-\d{6}\.sqlite$/m)[0]}`;
  const backupStat = docker('exec', name, 'stat', '-c', '%u %a', backupFile);
  step('the start-up backup is owned by 10001 with mode 600', backupStat === '10001 600', backupStat);
  const integrity = docker('exec', name, 'node', '--disable-warning=ExperimentalWarning', '-e',
    "const { DatabaseSync } = require('node:sqlite'); const db = new DatabaseSync(process.argv[1], { readOnly: true }); console.log(db.prepare('PRAGMA integrity_check').get().integrity_check);",
    backupFile);
  step('the start-up backup passes an independent PRAGMA integrity_check', integrity === 'ok', integrity);
  const dbMode = docker('exec', name, 'stat', '-c', '%a', '/data/budget.sqlite');
  step('the database file is mode 600', dbMode === '600', dbMode);

  const health = await waitFor(() => {
    const value = docker('inspect', '--format', '{{.State.Health.Status}}', name);
    return value === 'healthy' ? value : undefined;
  }, 'the container to become healthy');
  step('the HEALTHCHECK reaches healthy', health === 'healthy');

  const code = lastCode();
  step('the setup code is in the log from boot', Boolean(code));

  const fileStat = docker('exec', name, 'stat', '-c', '%u %a', '/data/SETUP_CODE.txt');
  step('SETUP_CODE.txt is owned by 10001 with mode 600', fileStat === '10001 600', fileStat);
  step('SETUP_CODE.txt holds the logged code', docker('exec', name, 'cat', '/data/SETUP_CODE.txt') === code);

  const setup = await post('/api/auth/setup', { code, email: 'smoke@example.com', password: 'a perfectly fine password' });
  step('setup succeeds', setup.status === 200, setup.body);
  step('SETUP_CODE.txt is removed once setup completes', spawnSync('docker', ['exec', name, 'test', '-e', '/data/SETUP_CODE.txt']).status !== 0);
  const userId = JSON.parse(setup.body).userId;
  const setCookie = [].concat(setup.headers['set-cookie'] ?? [])[0] ?? '';
  const cookie = setCookie.split(';')[0];

  if (tls || proxy) {
    step('the session cookie is __Host- and Secure', setCookie.startsWith('__Host-budget_session=') && setCookie.includes('Secure'), setCookie);
  }
  if (tls) {
    const redirect = await request(`http://127.0.0.1:${http80}`, '/', { headers: { Host: 'localhost' } });
    step('HTTP redirects to HTTPS', [301, 302, 307, 308].includes(redirect.status) && String(redirect.headers.location).startsWith('https://'), `${redirect.status} ${redirect.headers.location}`);
  }
  if (!tls && !proxy) {
    step('the session cookie is set', cookie.startsWith('budget_session='), setCookie);
  }

  const me = await get('/api/auth/me', { Cookie: cookie });
  step('the session works', me.status === 200, me.body);
  const anonymous = await get('/api/categories');
  step('the API refuses an anonymous request', anonymous.status === 401, String(anonymous.status));
  const crossSite = await post('/api/auth/logout', {}, { Origin: 'https://evil.example', Cookie: cookie });
  step('a request from another origin is refused', crossSite.status === 403, String(crossSite.status));

  // Sends a request with a forged X-Forwarded-For to an API route that answers 401, waits for the app to log exactly one
  // new "Request:" line for it, and returns that line's sourceIp.
  const countRequests = () => (dockerLogs().match(/sourceIp: '/g) ?? []).length;
  const spoofedSourceIp = async forged => {
    const before = countRequests();
    const response = await get('/api/categories', { 'X-Forwarded-For': forged });
    step(`the spoofed request is answered 401 (${forged})`, response.status === 401, String(response.status));
    await waitFor(() => countRequests() === before + 1, 'one new Request: log line');
    return [...dockerLogs().matchAll(/sourceIp: '([^']*)'/g)].map(match => match[1]).at(-1);
  };
  if (tls) {
    // Caddy must replace a client-supplied X-Forwarded-For, so the app never sees the spoofed address.
    const seen = await spoofedSourceIp('6.6.6.6');
    step(`through Caddy the logged client address is not the spoofed one (logged: ${seen})`, Boolean(seen) && seen !== '6.6.6.6' && seen !== '7.7.7.7');
  } else if (proxy) {
    // TRUST_PROXY is on, so the app logs the forwarded client address.
    const seen = await spoofedSourceIp('198.51.100.9');
    step(`with TRUST_PROXY on the logged client address is the forwarded one (logged: ${seen})`, seen === '198.51.100.9');
  } else {
    // TRUST_PROXY is off by default without TLS_DOMAIN, so a forwarding header is ignored.
    const seen = await spoofedSourceIp('6.6.6.6');
    step(`with TRUST_PROXY off the logged client address is not the spoofed one (logged: ${seen})`, Boolean(seen) && seen !== '6.6.6.6');
  }

  docker('restart', name);
  await waitFor(async () => (await get('/healthz')).status === 200, '/healthz after a restart');
  const after = await get('/api/auth/me', { Cookie: cookie });
  step('data and the session survive a restart', after.status === 200, after.body);
  const again = await get('/api/auth/status');
  step('setup stays closed after a restart', JSON.parse(again.body).setupRequired === false, again.body);

  const backup = docker('exec', '-e', 'STORE=sqlite', '-e', 'SQLITE_PATH=/data/budget.sqlite', name,
    'node', 'build/store-cli/store-cli.js', 'backup', '--out', '/data/manual-backup.sqlite');
  step('store-cli backup works inside the image', backup.includes('Backed up'), backup);

  // Password recovery without a shell: create the marker as the app user, restart, set a new password with the logged code.
  docker('exec', name, 'touch', '/data/RESET_PASSWORD');
  docker('restart', name);
  await waitFor(async () => (await get('/healthz')).status === 200, '/healthz after the recovery restart');
  step('the reset marker is consumed at start-up', spawnSync('docker', ['exec', name, 'test', '-e', '/data/RESET_PASSWORD']).status !== 0);
  const opened = JSON.parse((await get('/api/auth/status')).body);
  step('recovery is open and setup stays closed', opened.recoveryOpen === true && opened.setupRequired === false, JSON.stringify(opened));
  const oldSession = await get('/api/auth/me', { Cookie: cookie });
  step('the old session ended when recovery opened', oldSession.status === 401, String(oldSession.status));
  const recoveryCode = await waitFor(() => { const next = lastCode(); return next && next !== code ? next : undefined; }, 'a recovery code in the log', 30_000);
  step('SETUP_CODE.txt holds the recovery code', docker('exec', name, 'cat', '/data/SETUP_CODE.txt') === recoveryCode);
  const NEW_PASSWORD = 'a different perfectly fine password';
  const recovered = await post('/api/auth/setup', { code: recoveryCode, password: NEW_PASSWORD });
  step('recovery with the code succeeds', recovered.status === 200, recovered.body);
  const recoveredCookie = ([].concat(recovered.headers['set-cookie'] ?? [])[0] ?? '').split(';')[0];
  const meAfter = await get('/api/auth/me', { Cookie: recoveredCookie });
  step('it is the same account after recovery', meAfter.status === 200 && JSON.parse(meAfter.body).userId === userId, meAfter.body);
  const newLogin = await post('/api/auth/login', { email: 'smoke@example.com', password: NEW_PASSWORD });
  step('the new password signs in', newLogin.status === 200, newLogin.body);
  const oldLogin = await post('/api/auth/login', { email: 'smoke@example.com', password: 'a perfectly fine password' });
  step('the old password no longer signs in', oldLogin.status === 401, String(oldLogin.status));
  step('SETUP_CODE.txt is removed once recovery completes', spawnSync('docker', ['exec', name, 'test', '-e', '/data/SETUP_CODE.txt']).status !== 0);
  const closed = JSON.parse((await get('/api/auth/status')).body);
  step('recovery is closed again', closed.recoveryOpen === false, JSON.stringify(closed));

  const started = Date.now();
  docker('stop', '-t', '20', name);
  const seconds = (Date.now() - started) / 1000;
  const exitCode = docker('inspect', '--format', '{{.State.ExitCode}}', name);
  step(`docker stop exits 0 within 15 s (took ${seconds.toFixed(1)} s)`, exitCode === '0' && seconds < 15, `exit ${exitCode} after ${seconds}s`);
}

try {
  await main();
  console.log('All steps passed');
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  console.error(dockerLogs('--tail', '60'));
  process.exitCode = 1;
} finally {
  cleanup();
}
