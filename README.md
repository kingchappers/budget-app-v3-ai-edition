# Authentication Tester App

This is a small scale attempt to integrate authentication within a basic react application. This is a single-page application (SPA) that allows users to login via Auth0 and make authenticated API requests to protected endpoints.

The application is deployed to AWS Lambda and API Gateway using OpenTofu (Infrastructure as Code). It's designed to be cheap to run and easy to maintain.

This serves as a template for future projects requiring web apps with authentication and protected APIs.

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
- **Handler:** `build/client/index.js` (compiled from `handler.ts`)
- **Routes:**
  - `GET /` → serves `index.html` (SPA entry point)
  - `GET /assets/*` → serves JS/CSS files with correct MIME types
  - Falls back to `index.html` for any unknown route (enables client-side routing)
- **Authentication:** None required - publicly accessible
- **Purpose:** Serves your React app and static assets

### 4. Protected API Lambda
- **Handler:** `build/api/index.js` (compiled from `api-handler.ts`)
- **Routes:**
  - `GET/POST /api/test` → test endpoint (requires JWT)
  - `GET/POST /api/user-info` → returns authenticated user info (requires JWT)
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

### User clicks "Test API" button:
1. `ApiTest` component calls `useProtectedApi().request('/api/test')`
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
| `handler.ts` | Source code for Static File Server Lambda |
| `build/client/index.js` | Compiled static file server (auto-generated) |
| `build/api/index.js` | Compiled API handler (auto-generated) |
| `app/hooks/useProtectedApi.ts` | React hook to make authenticated API requests |
| `app/components/api/ApiTest.tsx` | UI component with test buttons for API endpoints |
| `app/components/layout/DefaultLayout.tsx` | Auth0Provider wrapper - maintains auth state globally |
| `infra/lambda.tf` | Terraform: Static File Server Lambda + API Gateway |
| `infra/api-lambda.tf` | Terraform: Protected API Lambda + routes |
| `scripts/inject-handler.cjs` | Build script: injects handler into static files |
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
