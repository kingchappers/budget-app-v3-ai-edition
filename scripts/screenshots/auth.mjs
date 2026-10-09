// Dummy Auth0 values for the screenshot run. They point at nothing real; the harness sets them itself and
// refuses to run if the shell already has different ones, so it can never reach a real tenant.
export const DUMMY_ENV = {
  VITE_AUTH0_DOMAIN: 'screenshots.invalid',
  VITE_AUTH0_CLIENT_ID: 'dummy',
  VITE_AUTH0_AUDIENCE: 'https://screenshots.invalid/api',
};

const SCOPE = 'openid profile email offline_access';

// The Auth0 SPA SDK keeps a signed-in session in localStorage under keys it builds from the client id and
// audience. Seeding them makes the app believe someone is signed in, so no sign-in page is ever visited.
export function authStorage(now = new Date()) {
  const { VITE_AUTH0_CLIENT_ID: clientId, VITE_AUTH0_AUDIENCE: audience } = DUMMY_ENV;
  const user = { sub: 'auth0|demo', name: 'Demo User', email: 'demo@example.invalid' };
  const claims = { ...user, __raw: 'demo.id.token', iss: `https://${DUMMY_ENV.VITE_AUTH0_DOMAIN}/`, aud: clientId };
  const tokenKey = `@@auth0spajs@@::${clientId}::${audience}::${SCOPE}`;
  const expiresAt = Math.floor(now.getTime() / 1000) + 24 * 3600;

  return {
    [tokenKey]: JSON.stringify({
      body: {
        client_id: clientId, access_token: 'demo-access', id_token: 'demo.id.token', scope: SCOPE,
        expires_in: 86400, token_type: 'Bearer', audience,
        decodedToken: { claims, user }, oauthTokenScope: SCOPE,
      },
      expiresAt,
    }),
    [`@@auth0spajs@@::${clientId}`]: JSON.stringify({ keys: [tokenKey] }),
    [`@@auth0spajs@@::${clientId}::@@user@@`]: JSON.stringify({ id_token: 'demo.id.token', decodedToken: { claims, user } }),
    // Hide the one-time "What's changed" cards and the first-run tour, which would otherwise sit in the shots,
    // and leave the two Insights charts open so that shot shows them.
    'budget.preferences': JSON.stringify({ seenReleases: ['menu-2026-10', 'names-2026-10'], tourStep: 3, insightsOpenSections: ['groups', 'trend'] }),
  };
}
