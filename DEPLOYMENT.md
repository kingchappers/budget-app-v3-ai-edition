# AWS Deployment Documentation

## Overview

This document explains how the authentication app is deployed to AWS, what resources are created, how they're configured, and how JWT authentication works within the API Gateway and Lambda functions.

---

## Deployment Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Internet                                 │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│                    API Gateway (HTTP v2)                        │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ Route: $default                 Route: /api/{proxy+}     │  │
│  │ Target: Static File Server      Target: API Lambda       │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
        ↓                                  ↓
┌──────────────────────────┐    ┌──────────────────────────┐
│  Static File Server      │    │   API Lambda            │
│  Lambda Function         │    │   (Protected with JWT)  │
│                          │    │                         │
│ • Serves HTML/CSS/JS     │    │ • Validates JWT         │
│ • MIME type handling     │    │ • Checks Auth0 signature│
│ • SPA routing fallback   │    │ • Returns user data     │
└──────────────────────────┘    └──────────────────────────┘
        ↓                                ↓
┌──────────────────────────┐    ┌──────────────────────────┐
│   build/client/          │    │   build/api/            │
│  • index.html            │    │  • index.js             │
│  • index.js (handler)    │    │  • node_modules/        │
│  • assets/               │    │    - jsonwebtoken       │
└──────────────────────────┘    └──────────────────────────┘
```

---

## What Gets Deployed

### 1. Two AWS Lambda Functions

#### Static File Server Lambda
- **Name:** `auth-starter-app` (from `var.app_name`)
- **Handler:** `index.handler` (points to `build/client/index.js`)
- **Runtime:** Node.js 24.x
- **Memory:** 512 MB
- **Timeout:** 30 seconds
- **Environment Variables:**
  - `NODE_ENV: production`
  - `VITE_AUTH0_DOMAIN` - Auth0 domain (for React app)
  - `VITE_AUTH0_CLIENT_ID` - Auth0 client ID (for React app)
- **Code Source:** `build/client/` directory zipped

#### API Lambda
- **Name:** `auth-starter-app-api` (from `${var.app_name}-api`)
- **Handler:** `index.handler` (points to `build/api/index.js`)
- **Runtime:** Node.js 24.x
- **Memory:** 512 MB
- **Timeout:** 30 seconds
- **Environment Variables:**
  - `NODE_ENV: production`
  - `AUTH0_DOMAIN` - Auth0 domain (for JWT validation)
  - `AUTH0_AUDIENCE` - Auth0 API audience (for JWT validation)
- **Code Source:** `build/api/` directory zipped with `node_modules/`

### 2. API Gateway (HTTP v2)

- **Protocol:** HTTP (not REST)
- **Name:** `auth-starter-app-api`
- **CORS Configuration:**
  - Allowed Origins: `*` (all origins)
  - Allowed Methods: GET, HEAD, OPTIONS, POST, PUT, PATCH, DELETE
  - Allowed Headers: `*` (all headers)
  - Exposed Headers: `*` (all response headers)
  - Max Age: 300 seconds

### 3. Routes & Integrations

The API Gateway has two routes:

| Route | Method | Target | Purpose |
|-------|--------|--------|---------|
| `$default` | ALL | Static File Server Lambda | Serves React app + static assets |
| `/api/{proxy+}` | GET | API Lambda | Protected endpoints (JWT required) |
| `/api/{proxy+}` | POST | API Lambda | Protected endpoints (JWT required) |

### 4. IAM Permissions

#### Lambda Execution Role (`auth-starter-app-lambda-role`)

The role allows Lambda functions to:
- Write logs to CloudWatch (via `AWSLambdaBasicExecutionRole` policy)
- Be invoked by API Gateway

Permissions granted:
```json
{
  "Effect": "Allow",
  "Principal": {
    "Service": "apigateway.amazonaws.com"
  },
  "Action": "lambda:InvokeFunction",
  "Resource": "arn:aws:lambda:...:function:auth-starter-app*"
}
```

#### API Gateway CloudWatch Role

Allows API Gateway to write request logs to CloudWatch:
- `logs:CreateLogStream`
- `logs:PutLogEvents`
- `logs:CreateLogGroup`

### 5. CloudWatch Logs

- **Log Group:** `/aws/apigateway/auth-starter-app`
- **Retention:** 7 days
- **Logs:** All API requests and responses

---

## How Deployment Works (CI/CD Flow)

### Trigger
Deployment automatically runs on:
- Push to `main` branch
- Pull requests to `main` (plan only, no apply)

### Step 1: Build Phase (GitHub Actions)

**File:** `.github/workflows/yarnBuild.yml`

```bash
yarn install
```
- Installs all Node.js dependencies

```bash
VITE_AUTH0_DOMAIN=${{ secrets.AUTH0_DOMAIN }} \
VITE_AUTH0_CLIENT_ID=${{ secrets.AUTH0_CLIENT_ID }} \
VITE_AUTH0_AUDIENCE=${{ secrets.AUTH0_AUDIENCE }} \
yarn run build
```

- Builds React app with Auth0 configuration from GitHub Secrets
- Injects static file server handler
- Compiles API handler and installs dependencies
- Output: `build/client/` and `build/api/` directories

### Step 2: AWS Credentials

```bash
role-to-assume: arn:aws:iam::192350001975:role/github-actions
aws-region: eu-west-2
```

- Assumes GitHub Actions IAM role using OIDC (no long-lived credentials)
- Assumes role in account `192350001975` in `eu-west-2` region

### Step 3: OpenTofu Plan

```bash
cd infra
tofu init
tofu plan -out=tfplan
```

- Initializes Terraform backend (S3 bucket for state)
- Plans infrastructure changes
- Compares current state with desired state from `.tf` files
- Outputs to `tfplan` artifact

### Step 4: OpenTofu Apply (Main Branch Only)◊

```bash
if: github.ref == 'refs/heads/main' && github.event_name == 'push'
tofu apply -auto-approve tfplan
```

- **Only runs on successful push to main** (not on PRs)
- Uses `-auto-approve` to skip interactive approval
- Creates or updates all AWS resources
- Updates Lambda functions with new code
- Uploads zip files to AWS

---

## Configuration & Environment Variables

### GitHub Secrets Required

Store these in GitHub repository settings (Settings → Secrets and variables → Actions):

```
AUTH0_DOMAIN              # e.g., "dev-xxxxxxxxxxxxxxxx.uk.auth0.com"
AUTH0_CLIENT_ID           # OAuth 2.0 Client ID from Auth0
AUTH0_AUDIENCE            # e.g., "https://dev-xxxxxxxxxxxxxxxx.uk.auth0.com/api/v2/"
```

### Terraform Variables

**File:** `infra/terraform.tfvars`

```hcl
aws_region     = "eu-west-2"
state_bucket   = "kingchappers-terraform-state-bucket"
app_name       = "auth-starter-app"
environment    = "production"
auth0_audience = "https://dev-xf4mizgda1uv0xvb.uk.auth0.com/api/v2/"
```

### Environment Variables Passed to Lambda

**Static File Server Lambda:**
- `NODE_ENV=production`
- `VITE_AUTH0_DOMAIN` - From `var.auth0_domain` (secrets)
- `VITE_AUTH0_CLIENT_ID` - From `var.auth0_client_id` (secrets)

**API Lambda:**
- `NODE_ENV=production`
- `AUTH0_DOMAIN` - From `var.auth0_domain` (secrets)
- `AUTH0_AUDIENCE` - From `var.auth0_audience` (from tfvars)

---

## JWT Authentication Flow in API Gateway

### Complete JWT Flow

```
┌────────────────────────────────────────────────────────────────┐
│ 1. User logs in via Auth0 login button in React app            │
└────────────────────────────────────────────────────────────────┘
                              ↓
┌────────────────────────────────────────────────────────────────┐
│ 2. Auth0 issues JWT with claims:                               │
│    - sub (user ID)                                             │
│    - email                                                     │
│    - aud (audience): "https://.../api/v2/"                     │
│    - iss (issuer): "https://{AUTH0_DOMAIN}/"                   │
│    - exp (expiration time)                                     │
└────────────────────────────────────────────────────────────────┘
                              ↓
┌────────────────────────────────────────────────────────────────┐
│ 3. Browser stores JWT in memory via Auth0 React SDK            │
└────────────────────────────────────────────────────────────────┘
                              ↓
┌────────────────────────────────────────────────────────────────┐
│ 4. React component calls useProtectedApi hook:                 │
│    - Gets JWT from Auth0 using getAccessTokenSilently()        │
│    - Makes fetch to /api/test with header:                     │
│      Authorization: Bearer {JWT}                               │
└────────────────────────────────────────────────────────────────┘
                              ↓
┌────────────────────────────────────────────────────────────────┐
│ 4.5. Request sent to API Gateway                               │
└────────────────────────────────────────────────────────────────┘
                              ↓
┌────────────────────────────────────────────────────────────────┐
│ 5. API Gateway matches route /api/test                         │
│    - Routes to API Lambda                                      │
│    - Passes Authorization header through                       │
└────────────────────────────────────────────────────────────────┘
                              ↓
┌────────────────────────────────────────────────────────────────┐
│ 6. API Lambda receives request:                                │
│    - Extracts JWT from Authorization header                    │
│    - Calls verify() with JWT, getKey callback, audience        │
└────────────────────────────────────────────────────────────────┘
                              ↓
┌────────────────────────────────────────────────────────────────┐
│ 7. JWT Verification Process:                                   │
│                                                                │
│    a) Extract kid (key ID) from JWT header                     │
│    b) Fetch Auth0's JWKS (public keys) from:                   │
│       https://{AUTH0_DOMAIN}/.well-known/jwks.json             │
│    c) Find matching public key by kid                          │
│    d) Verify JWT signature using public key                    │
│    e) Check audience == AUTH0_AUDIENCE                         │
│    f) Check issuer == Auth0                                    │
│    g) Check expiration time (not expired)                      │
│                                                                │
└────────────────────────────────────────────────────────────────┘
                              ↓
         ┌────────────────────┴────────────────────┐
         ↓ (Valid)                        ↓ (Invalid)
┌──────────────────────┐          ┌──────────────────────┐
│ 8. JWT Valid:        │          │ 8. JWT Invalid:      │
│ Decode token         │          │ Return 401           │
│ Extract claims       │          │ Return error message │
│ (sub, email, name)   │          └──────────────────────┘
└──────────────────────┘                    ↓
         │                        ┌──────────────────────────┐
         ↓                        │ Response sent to browser │
┌──────────────────────────┐      │ Error displayed in React │
│ 9. Execute endpoint:     │      │ component                │
│    handleTestEndpoint()  │      └──────────────────────────┘
│ 10. Return JSON with data│       
│ 11. Response sent to     │
│     browser              │
│ 12. React displays       │
│     response             │
└──────────────────────────┘
```

### JWT Validation Code (api-handler.ts)

```typescript
// Environment variables (set by Terraform)
const AUTH0_DOMAIN = process.env.AUTH0_DOMAIN;   // "dev-...auth0.com"
const AUTH0_AUDIENCE = process.env.AUTH0_AUDIENCE; // "https://.../api/v2/"

// Create JWKS client with caching
const client = jwksClient({
  cache: true,
  cacheMaxAge: 600000, // Cache public keys for 10 minutes
  jwksUri: `https://${AUTH0_DOMAIN}/.well-known/jwks.json`,
});

// Callback to get signing key
function getKey(header, callback) {
  // Extract kid from JWT header
  client.getSigningKey(header.kid, (err, key) => {
    if (err) {
      callback(err);
    } else {
      callback(null, key?.getPublicKey());
    }
  });
}

// Verify JWT
const decoded = await new Promise((resolve, reject) => {
  verify(
    token,
    getKey,
    {
      audience: AUTH0_AUDIENCE,  // Must match JWT aud claim
      issuer: `https://${AUTH0_DOMAIN}/`, // Implicit check
      algorithms: ['RS256']      // Implicit, only RS256 supported
    },
    (err, decoded) => {
      if (err) reject(err);
      else resolve(decoded);
    }
  );
});
```

### What Happens with Invalid JWT?

| Issue | Result | HTTP Status |
|-------|--------|-------------|
| No Authorization header | "Missing authorization token" | 401 |
| Malformed token | JWT verification error | 401 |
| Invalid signature | "invalid signature" | 401 |
| Expired token | "token expired" | 401 |
| Wrong audience | "audience mismatch" | 401 |
| Wrong issuer | "issuer mismatch" | 401 |

---

## Local Deployment (Manual)

To deploy without CI/CD:

### 1. Build the Application

```bash
cd /Users/samuelchapman/Projects/auth-app
yarn install
yarn build
```

This generates:
- `build/client/` - React app + static file server handler
- `build/api/` - API Lambda + dependencies

### 2. Deploy to AWS

```bash
cd infra
tofu init              # Initialize Terraform backend
tofu plan              # See what will be created/updated
tofu apply             # Deploy to AWS
```

### 3. Get the API Endpoint

```bash
tofu output api_endpoint
# Output: https://xxxxx.execute-api.eu-west-2.amazonaws.com/
```

---

## Monitoring & Debugging

### CloudWatch Logs

View API Gateway logs:
```bash
aws logs tail /aws/apigateway/auth-starter-app --follow
```

View Lambda logs:
```bash
# Static file server
aws logs tail /aws/lambda/auth-starter-app --follow

# API Lambda
aws logs tail /aws/lambda/auth-starter-app-api --follow
```

### Common Log Messages

**Static File Server:**
```
Error: open build/client/assets/index.js: no such file or directory
```
→ File hasn't been built yet, run `yarn build`

**API Lambda:**
```
Received event: {...}
Auth header: Bearer eyJhbGc...
No token found
```
→ Missing Authorization header

**API Lambda:**
```
Unhandled error: jwt malformed
```
→ Token format invalid or missing Bearer prefix

**API Lambda:**
```
Unhandled error: audience mismatch
```
→ JWT audience doesn't match `AUTH0_AUDIENCE` environment variable

### Test with curl

```bash
# Get endpoint
ENDPOINT=$(aws apigatewayv2 get-apis --query 'Items[0].ApiEndpoint' --output text)

# Test static file server
curl $ENDPOINT/

# Test API (will fail without JWT)
curl -X POST $ENDPOINT/api/test

# Test API with valid JWT (get token from browser Auth0 session first)
curl -X POST $ENDPOINT/api/test \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

---

## Architecture Decisions

### Why Two Lambda Functions?

1. **Separation of Concerns:** Static files are public, API is protected
2. **Independent Scaling:** Can scale each based on traffic patterns
3. **Different Runtimes:** Could use different runtime versions in future
4. **Security:** API Lambda only needs JWT validation, not file serving overhead

### Why HTTP API Instead of REST API?

1. **Cost:** HTTP API is cheaper than REST API ($0.60 vs $3.50 per million requests)
2. **Performance:** Slightly lower latency
3. **Sufficient:** We don't need REST API's advanced features

### Why Environment Variables Instead of Config Files?

1. **Security:** Secrets never committed to version control
2. **Flexibility:** Different values per environment (dev/staging/prod)
3. **Lambda Best Practice:** Recommended pattern for serverless

### Why JWKS Caching?

1. **Performance:** Reduces Auth0 API calls
2. **Reliability:** Works if Auth0 is temporarily unavailable
3. **Cost:** Fewer outbound calls = faster response times

---

## Security Considerations

### Frontend (Static File Server Lambda)
- ✅ HTTPS only (API Gateway enforces)
- ✅ CORS headers included
- ✅ No authentication required (public app)
- ⚠️ CORS allows all origins (consider restricting in production)

### API Lambda
- ✅ JWT signature verified with Auth0's public key
- ✅ JWT expiration checked
- ✅ Audience validation (prevents token reuse)
- ✅ Issuer validation (prevents tokens from other Auth0 tenants)
- ✅ All traffic encrypted via HTTPS
- ✅ Logs to CloudWatch (audit trail)

### Recommendations for Production

1. **Restrict CORS Origins:**
   ```terraform
   allow_origins = ["https://yourdomain.com"]  # Instead of "*"
   ```

2. **Increase CloudWatch Retention:**
   ```terraform
   retention_in_days = 30  # Instead of 7
   ```

3. **Add WAF (Web Application Firewall):** Protect API Gateway from attacks

4. **Enable X-Ray Tracing:** Debug request flow through Lambdas

5. **Use Custom Domain:** Instead of AWS-generated domain

6. **Rate Limiting:** Add Lambda Authorizer or API Gateway throttling

---

## Rollback & Recovery

### If Deployment Fails

```bash
# Check what happened
cd infra
tofu show

# View previous state
tofu show -json | jq .values

# Rollback to previous state
git revert <commit>
tofu apply
```

### If Lambda Code Has Bug

```bash
# Deploy previous working code
git revert <commit>
yarn build
cd infra
tofu apply

# Check logs to find issue
aws logs tail /aws/lambda/auth-starter-app-api --follow
```

---

## Cost Estimation (Monthly)

Based on typical usage:

| Resource | Usage | Cost |
|----------|-------|------|
| Lambda (both) | 1M requests/month | $0.20 |
| Lambda (GB-seconds) | ~100 GB-seconds | $1.67 |
| API Gateway | 1M requests | $0.60 |
| CloudWatch Logs | ~5 GB | $2.50 |
| **Total** | | **~$5** |

This assumes moderate usage. Costs scale with traffic.

---

## Next Steps / Maintenance

1. **Monitor CloudWatch Logs:** Check for errors regularly
2. **Update Dependencies:** Run `yarn upgrade` monthly
3. **Review Auth0 Configuration:** Ensure audience/domain match
4. **Test Disaster Recovery:** Practice rollback procedures
5. **Security Audit:** Review IAM permissions annually
