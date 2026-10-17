import { describe, expect, it } from 'vitest';
import { buildCaddyfile } from '../caddy';

const base = { tlsDomain: 'budget.example.com', port: 8080, dataDir: '/data' };

describe('buildCaddyfile', () => {
  it('produces the expected file with an email', () => {
    expect(buildCaddyfile({ ...base, tlsEmail: 'me@example.com' })).toBe([
      '{',
      '\tadmin off',
      '\tskip_install_trust',
      '\tstorage file_system /data/caddy',
      '\temail me@example.com',
      '}',
      '',
      'budget.example.com {',
      '\tencode zstd gzip',
      '\treverse_proxy 127.0.0.1:8080',
      '}',
      '',
    ].join('\n'));
  });

  it('leaves the email line out when there is none', () => {
    expect(buildCaddyfile(base)).not.toContain('email');
  });

  it.each([
    ['a newline', 'evil.com {\nrespond "x"\n}'], ['a space', 'a b.com'], ['a brace', 'a{b}.com'], ['a wildcard', '*.example.com'],
    ['a scheme', 'https://a.com'], ['a port', 'a.com:8443'], ['upper case', 'Budget.Example.com'], ['a path', 'a.com/x'],
    ['a trailing newline', 'budget.example.com\n'],
  ])('refuses a TLS_DOMAIN with %s', (_label, tlsDomain) => {
    expect(() => buildCaddyfile({ ...base, tlsDomain })).toThrow(/TLS_DOMAIN/);
  });

  it.each([
    'a b@x.com', 'a@x.com\nrespond', 'a{@x.com', 'x', 'me@example.com`', "me@example.com'",
  ])('refuses a TLS_EMAIL of %j', tlsEmail => {
    expect(() => buildCaddyfile({ ...base, tlsEmail })).toThrow(/TLS_EMAIL/);
  });

  it.each([0, -1, 70000, 1.5])('refuses the port %s', port => {
    expect(() => buildCaddyfile({ ...base, port })).toThrow(/port/i);
  });

  it.each([
    '/data dir', '/data\n/x', 'relative', '/data;rm', '/da{ta}', '/data/../x', '/',
  ])('refuses the data dir %j', dataDir => {
    expect(() => buildCaddyfile({ ...base, dataDir })).toThrow(/DATA_DIR/);
  });

  it('accepts a data dir with dots, underscores and hyphens', () => {
    expect(buildCaddyfile({ ...base, dataDir: '/var/lib/budget-1/x_y.z' })).toContain('storage file_system /var/lib/budget-1/x_y.z/caddy');
  });
});
