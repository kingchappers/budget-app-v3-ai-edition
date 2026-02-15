# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Authentication template app: React SPA + Auth0 + AWS Lambda. Two Lambda functions serve the app — one for static files (public), one for protected API endpoints (JWT-validated). Infrastructure managed with OpenTofu.

## Commands

```bash
yarn install          # Install dependencies
yarn dev              # Start dev server with hot reload
yarn build            # Three-stage build: react-router build → inject static handler → compile API handler
yarn typecheck        # Generate route types + run tsc
```

**Build requires Auth0 env vars** (set in `.env` or exported):
- `VITE_AUTH0_DOMAIN`, `VITE_AUTH0_CLIENT_ID`, `VITE_AUTH0_AUDIENCE`

**Deploy** (after build):
```bash
cd infra && tofu apply
```

No test framework is configured yet.

## Architecture

### Two Lambda Functions

1. **Static File Server** (`build/client/index.js`) — serves React SPA assets, falls back to `index.html` for client-side routing. No auth. Handler is *injected* by `scripts/inject-handler.cjs` (not compiled from source).

2. **Protected API** (`build/api/index.js`) — compiled from `api-handler.ts`. Validates JWT via Auth0 JWKS. Routes: `/api/test`, `/api/user-info`. Dependencies bundled into `build/api/node_modules/` by `scripts/build-api-handler.cjs`.

### Build Pipeline

`yarn build` chains three steps with `&&`:
1. `react-router build` → `build/client/` (assets) + `build/server/` (unused)
2. `inject-handler.cjs` → overwrites `build/client/index.js` with static file server handler
3. `build-api-handler.cjs` → compiles `api-handler.ts` to `build/api/index.js`, installs production deps

### Frontend

- **React 19** + **React Router v7** (SPA mode, `ssr: false`)
- **Mantine 8** UI library + **Tailwind CSS** for styling
- File-based routing in `app/routes/` (e.g., `_index.tsx` → `/`, `test.tsx` → `/test`)
- Path alias: `~/*` → `./app/*`
- Auth state managed globally via `Auth0Provider` in `DefaultLayout.tsx`
- `useProtectedApi` hook handles Bearer token injection for API calls

### Infrastructure (`infra/`)

- OpenTofu/Terraform with AWS provider
- API Gateway HTTP API routes `$default` → static Lambda, `/api/{proxy+}` → API Lambda
- Lambda runtime: Node.js 24.x
- CI/CD: GitHub Actions builds + deploys on push to main

## Security

All code changes must follow security controls in `SECURITY.md`. Key requirements:
- Validate JWT on every API request (AUTH-01)
- Never commit secrets to git (SEC-01)
- Validate all input at API boundaries (IO-01)
- Least privilege cloud permissions (INFRA-01)
- Run security checklist before PRs

Reference control IDs in commits (e.g., "addresses AUTH-02", "fixes IO-03").

## Key Files

| File | Role |
|------|------|
| `SECURITY.md` | Security controls for all code/infrastructure changes |
| `api-handler.ts` | Protected API Lambda source (JWT validation, routing) |
| `app/hooks/useProtectedApi.ts` | React hook for authenticated fetch |
| `app/components/layout/DefaultLayout.tsx` | App shell with Auth0Provider |
| `scripts/inject-handler.cjs` | Generates static file server Lambda handler |
| `scripts/build-api-handler.cjs` | Compiles API handler + bundles deps |
| `infra/lambda.tf` | Static Lambda + API Gateway + IAM |
| `infra/api-lambda.tf` | API Lambda + routes |
