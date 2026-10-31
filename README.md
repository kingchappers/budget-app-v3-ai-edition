<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/brand/logo/hoardwise-lockup-dark-bg.svg">
    <img src="docs/brand/logo/hoardwise-lockup.svg" alt="Hoardwise" width="282">
  </picture>
</p>

# Hoardwise

A calm, self-hostable budgeting app: record what you spend, set a budget only if you want one, and keep money apart in pots for the things you are saving towards. It is designed to be gentle on attention, with neurodivergent users in mind.

You can [try the demo](https://demo.hoardwise.xyz) with invented data, [run it yourself](docs/SELF-HOSTING.md) as a single container, or deploy it to AWS Lambda with Auth0 (the original setup, described below).

## Architecture Overview

### 1. Frontend - React Router SPA
- React application with pages, components, and hooks
- Built with Vite and React Router
- Static files compiled to `build/client/`
- Served by a Lambda function that handles client-side routing

### 2. Authentication - Auth0
- Users authenticate via Auth0 (OAuth 2.0 / OpenID Connect)
- Auth0 issues a JWT (JSON Web Token) with an `audience` claim
- JWT is stored in browser memory via Auth0's React SDK
- The `Auth0Provider` component wraps the entire application, maintaining auth state globally

### 3. Static File Server Lambda
- **Handler:** `build/client/index.js` (compiled from `src/static/handler.ts`)
- **Routes:**
  - `GET /` → serves `index.html` (SPA entry point)
  - `GET /assets/*` → serves JS/CSS files with correct MIME types
  - Falls back to `index.html` for any unknown route without a file extension (enables client-side routing); a missing file with an extension returns 404
- **Authentication:** None required - publicly accessible
- **Purpose:** Serves your React app and static assets

### 4. Protected API Lambda
- **Handler:** `build/api/index.js` (compiled from `api-handler.ts`)
- **Routes:**
  - Categories, transactions, targets, pots, recurring items, accounts, trash and push subscriptions, all under `/api/...` (requires JWT)
  - The full route table is in `api-handler.ts`
- **Authentication:** All requests must include a valid JWT in the Authorization header
- **Validation:** 
  - Verifies JWT signature using Auth0's public keys (JWKS)
  - Checks token hasn't expired
  - Validates audience matches your API identifier
  - Confirms issuer is Auth0

### 5. API Gateway
- Routes requests to the appropriate Lambda function:
  - `$default` → Static File Server Lambda
  - `/api/{proxy+}` → Protected API Lambda
- Handles CORS for cross-origin requests
- Provides single public HTTPS endpoint

## How It Works - End-to-End Flow

### User visits the app:
1. Browser requests `https://api-gateway-url.execute-api.region.amazonaws.com/`
2. API Gateway routes to Static File Server Lambda
3. Lambda returns `index.html` with correct MIME type
4. React app loads in browser with all CSS/JS assets
5. `Auth0Provider` initializes, checks for existing Auth0 session

### User clicks Login:
1. `LoginButton` component calls `loginWithRedirect()`
2. User is redirected to Auth0 login page
3. After successful login, Auth0 redirects back to your app
4. React SDK exchanges authorization code for JWT token
5. JWT is stored in browser memory by Auth0 SDK
6. User sees their authenticated profile

### The app calls the API (for example, loading categories):
1. A query hook such as `useCategories` calls `useProtectedApi().request('/api/categories')`
2. `useProtectedApi` hook:
   - Calls `getAccessTokenSilently()` to retrieve JWT from Auth0
   - Makes fetch request with `Authorization: Bearer <JWT>`
3. Request goes through API Gateway → routed to Protected API Lambda
4. Lambda receives request with JWT in Authorization header
5. Lambda validates JWT:
   - Fetches Auth0's public key using JWKS client
   - Verifies JWT signature
   - Checks audience matches `AUTH0_AUDIENCE` environment variable
   - If valid, decodes JWT to extract user information
6. Lambda executes endpoint handler (e.g., `handleTestEndpoint()`)
7. Returns JSON response with user data
8. React component displays response in formatted box

### If JWT is invalid/missing:
- Lambda catches error
- Returns 401 Unauthorized with error message
- React component displays error in red box

## Key Files & Their Roles

| File | Purpose |
|------|---------|
| `api-handler.ts` | Source code for Protected API Lambda (JWT validation) |
| `build/client/index.js` | Compiled static file server (auto-generated) |
| `build/api/index.js` | Compiled API handler (auto-generated) |
| `app/hooks/useProtectedApi.ts` | React hook to make authenticated API requests |
| `app/components/layout/DefaultLayout.tsx` | Auth0Provider wrapper - maintains auth state globally |
| `infra/lambda.tf` | Terraform: Static File Server Lambda + API Gateway |
| `infra/api-lambda.tf` | Terraform: Protected API Lambda + routes |
| `src/static/handler.ts` | Static file server Lambda handler source |
| `scripts/build-static-handler.cjs` | Build script: compiles the static handler to `build/client/index.js` |
| `scripts/build-api-handler.cjs` | Build script: compiles API handler + installs deps |
| `.github/workflows/yarnBuild.yml` | CI/CD: builds app + deploys infrastructure |

## Security Model

- **Frontend is public** - Anyone can access and view the UI
- **API is protected** - Only requests with valid Auth0 JWT can access protected endpoints
- **JWT validation** - Lambda verifies:
  - Token signature (using Auth0's public key)
  - Token expiration time
  - Audience claim matches your API identifier
  - Issuer is Auth0
- **HTTPS only** - All communication is encrypted via API Gateway

## Deployment Flow

### Local Development:
```bash
yarn install    # Install dependencies
yarn dev        # Start dev server with hot reload
```

### Build & Deploy:
```bash
yarn build      # Compile React + API handler → generates build/ directory
cd infra
tofu apply      # Deploy/update infrastructure in AWS
```

### CI/CD (GitHub Actions):
1. Code is pushed to main branch
2. GitHub Actions workflow (`yarnBuild.yml`) runs:
   - Installs dependencies
   - Builds React app with Auth0 config from secrets
   - Compiles API handler
   - Runs OpenTofu plan/apply to update AWS resources
3. Both Lambdas are automatically updated

## Environment Variables

Create a `.env` file in the root directory:

```
VITE_AUTH0_DOMAIN=your-auth0-domain.auth0.com
VITE_AUTH0_CLIENT_ID=your-auth0-client-id
VITE_AUTH0_AUDIENCE=https://your-auth0-domain.auth0.com/api/v2/
```

These are embedded into the React app at build time. For deployment, use GitHub Secrets (`AUTH0_DOMAIN`, `AUTH0_CLIENT_ID`, `AUTH0_AUDIENCE`).

## Infrastructure

This project uses **OpenTofu** for Infrastructure as Code. The code is stored in the `infra/` folder.

Key resources:
- 2x Lambda functions (one for static files, one for API)
- 1x API Gateway (HTTP API)
- 1x IAM role for Lambda execution
- 1x CloudWatch log groups

## Components

Frontend is built with:
- **React** - UI library
- **React Router** - Client-side routing
- **Mantine** - Component library
- **Auth0 React SDK** - Authentication
- **TypeScript** - Type safety

Backend uses:
- **AWS Lambda** - Serverless compute
- **jsonwebtoken** - JWT verification
- **jwks-rsa** - Auth0 public key fetching

## Try the demo

The demo is the real app with an invented household, running entirely in your browser: an in-memory store plus the real API router and handlers stand in for the server. You are signed in as a fixed visitor, and a banner says changes stay in this browser tab and vanish on reload (a Reset demo button restores the starting data). Push reminders, the account/sign-in control and the PWA manifest are hidden. The demo is built to make no requests beyond its own origin: it answers same-origin `/api` and `/config.json` calls in memory, the build checks its HTML and CSS for external references, and the Content-Security-Policy below enforces the rule when your host sends it.

Live demo: https://demo.hoardwise.xyz (published from `main` by the workflow described in "Deploying the demo" below).

Build it with `yarn build:demo`. This needs no Auth0 values: the script uses dummy ones and refuses to run if real `VITE_AUTH0_*` values are set in your shell. The output is the site in `build/demo/client/` and a ready `Content-Security-Policy` header value in `build/demo/csp-header.txt` (with inline-script hashes) for your static host to send. The recommended header is that policy, and your host must send it for the browser to enforce it. The build also writes it, with a few other headers, as `_headers` in the site folder, which Cloudflare Pages and Netlify read. Any static host can serve it, but it must be served over HTTPS (or from `localhost`): the API handlers use `crypto.randomUUID`, which browsers only offer on secure origins. Unknown paths should fall back to `index.html`.

A normal `yarn build` wipes `build/demo`, so when building both locally, build the demo last. To check a built demo in a real browser, run `node scripts/demo-smoke.mjs` (Playwright; local only, not part of CI).

### Deploying the demo

`.github/workflows/demo.yml` publishes the demo to Cloudflare Pages on every push to `main`. It is plain static files, so there is no server to run, and Cloudflare serves static requests free of charge on its free plan. The workflow builds and checks the demo in one job that holds no secrets, then a second job verifies a checksum of the built site and publishes it. It never runs for pull requests or forks, and both jobs refuse to run from any branch except `main`. Until the two secrets below exist it still builds and checks the demo and skips publishing with a notice, so it is safe to merge first.

One-time setup (you need a Cloudflare account; nothing secret goes in this repository, and the dashboard menu names may differ slightly from these):

1. **Create the Pages project** with Direct Upload, named `budget-demo` (the workflow uses that name) and with `main` as the production branch. Either use the dashboard (Workers & Pages, Create, Pages, Direct Upload) or run `npx wrangler pages project create budget-demo --production-branch=main`.
2. **Create an API token** limited to your account with the single permission "Cloudflare Pages: Edit".
3. **Create a GitHub environment called `demo`** (Settings, Environments), set its deployment branches to `main` only, and add the two secrets **to that environment**, not to the repository: `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` (the account id is shown on the Cloudflare dashboard). This is what keeps the token away from any other branch or workflow.
4. **Run it**: Actions, "Deploy demo", Run workflow (or push to `main`). The site appears at `budget-demo.pages.dev`. Load a deep link such as `/transactions` once to confirm unknown paths fall back to the app.
5. **Add the custom domain** in the project's settings (Custom domains): `demo.hoardwise.xyz` (and `demo.budget.scgrid.xyz` while the old address stays live), and create the CNAME each one shows at your DNS provider (automatic when the domain's DNS is on Cloudflare).
6. **Leave Cloudflare Web Analytics off** for this project. It injects a third-party script, which the policy blocks and which would break the demo's promise of making no outside requests.

The publishing tool is pinned: `deploy/demo/package.json` and its lockfile fix the exact `wrangler` and every package under it, and the workflow installs them with `npm ci --ignore-scripts` in a step that holds no secret. That folder is separate from the app's Yarn dependencies, so the app's audit step does not cover it: to update, run `npm install --save-exact wrangler@<version> --ignore-scripts` and then `npm audit` in `deploy/demo`, and commit both files.

## Self-hosting

Run your own copy as a single container with SQLite and the built-in login: see [`docs/SELF-HOSTING.md`](docs/SELF-HOSTING.md).

## Use Hoardwise with an AI assistant

The `budget` skill teaches an AI coding agent to review your month in a calm, short way, looking at categories, pots and trends. If you ask it to, it will also log a spend.

1. Create a read token in the app under Settings > Access tokens.
2. Set `HOARDWISE_URL` (the address of your Hoardwise) and `HOARDWISE_TOKEN` in the environment of the shell that starts your agent. Never paste the token into a chat. To keep the token out of your shell history, put the `export` lines in a profile file that is kept out of git, or use a secrets manager.
3. Install the plugin in Claude Code:

   ```bash
   claude plugin install hoardwise --marketplace kingchappers/hoardwise
   ```

   This needs a recent version of Claude Code (the CLI form from v2.1.292); if yours doesn't have it, update Claude Code or use the two-step form. Inside a session, `/plugin install hoardwise --marketplace kingchappers/hoardwise` opens the install panel for the same plugin, where you choose where to install it. The two-step form is:

   ```bash
   claude plugin marketplace add kingchappers/hoardwise
   claude plugin install hoardwise@hoardwise
   ```

   To install by hand instead, copy `plugins/hoardwise/skills/budget` to `~/.claude/skills/budget` (all projects) or `.claude/skills/budget` (one project).
4. Ask: "How am I doing this month?"

The skill works with Claude Code and, as plain markdown, with other coding agents. The Claude desktop, web and mobile assistants will connect through MCP later. The full API description is [`docs/openapi.yaml`](docs/openapi.yaml).

Logged-in users can read the API reference in the app on the Docs page (Settings > API docs). The same description is served at `GET /api/openapi.json`, and `GET /api/docs/agents` returns a short guide written for AI agents. Both need your login or an access token.

For maintainers: change the skill only through a pull request, and bump `version` in `plugins/hoardwise/.claude-plugin/plugin.json` whenever the skill changes, because people only receive a new copy when that number changes. Anyone who wants a fixed version can add the marketplace at a tag, as `kingchappers/hoardwise#<tag>`, using a release tag from the first one that includes the plugin.

## Decisions

Notable architecture/product decisions — including things that were tried and reverted — are recorded in [`docs/DECISIONS.md`](docs/DECISIONS.md). Check there before re-attempting something that looks unbuilt but was actually tried before (e.g. automatic bank sync).

## Contributing and licence

The project is licensed under AGPL-3.0-or-later ([`LICENSE`](LICENSE)). Contributions are welcome: see [`CONTRIBUTING.md`](CONTRIBUTING.md), and note that a pull request needs agreement to the [Individual Contributor License Agreement](CLA.md) first.
