import { isValidEmail, isValidHostname } from './config';

export interface CaddyOptions {
  tlsDomain: string;
  tlsEmail?: string;
  port: number;
  dataDir: string;
}

const SAFE_PATH = /^\/[\w./-]*$/;

// Every value is validated again here, so nothing user-typed can reach Caddy's configuration as anything but a hostname, an
// email address, a port number or a plain path.
export function buildCaddyfile({ tlsDomain, tlsEmail, port, dataDir }: CaddyOptions): string {
  if (!isValidHostname(tlsDomain)) throw new Error('Refusing to write a Caddyfile for an invalid TLS_DOMAIN');
  if (tlsEmail !== undefined && !isValidEmail(tlsEmail)) throw new Error('Refusing to write a Caddyfile for an invalid TLS_EMAIL');
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Refusing to write a Caddyfile for an invalid port');
  if (!isSafeDataDir(dataDir)) throw new Error('Refusing to write a Caddyfile for an invalid DATA_DIR');

  return [
    '{',
    '\tadmin off',
    '\tskip_install_trust',
    `\tstorage file_system ${dataDir}/caddy`,
    ...(tlsEmail ? [`\temail ${tlsEmail}`] : []),
    '}',
    '',
    `${tlsDomain} {`,
    '\tencode zstd gzip',
    `\treverse_proxy 127.0.0.1:${port}`,
    '}',
    '',
  ].join('\n');
}

function isSafeDataDir(dataDir: string): boolean {
  return SAFE_PATH.test(dataDir) && dataDir !== '/' && !dataDir.split('/').includes('..');
}
