# Build Process Documentation

## Overview

Everything builds from a single `yarn build` command. The build script has **three sequential steps** defined in `package.json`:

```json
"build": "react-router build && node scripts/inject-handler.cjs && node scripts/build-api-handler.cjs"
```

If any step fails, the entire build stops.

---

## Step 1: React Router Build

```bash
react-router build
```

### What It Does
Compiles your React application using Vite and React Router's build system.

### Output Location
- `build/client/` - client-side assets
- `build/server/` - server-side code

### Generated Files
- `build/client/index.html` - main HTML entry point
- `build/client/assets/` - JavaScript bundles, CSS, manifest files
  - Example: `_index-CjGoVtFd.js`, `root-DhphxH0k.css`, etc.
- `build/server/index.js` - server-side rendering code (not used for Lambda)

### Purpose
This is the standard React Router build output that compiles your TypeScript/JSX components into optimized, minified JavaScript and CSS files.

---

## Step 2: Inject Handler (Static File Server)

```bash
node scripts/inject-handler.cjs
```

### What It Does
Injects the static file server handler code directly into `build/client/index.js`

### How It Works
The script [`scripts/inject-handler.cjs`](scripts/inject-handler.cjs):
1. Defines the static file server handler as a Node.js function
2. Writes it as a string to `build/client/index.js`

This handler:
- Serves HTML, JS, CSS, JSON, images, and font files with correct MIME types
- Falls back to `index.html` for unknown routes (enables client-side routing for SPA)
- Includes security checks to prevent path traversal attacks

### Output Location
- `build/client/index.js` - becomes the Lambda handler for the static file server

### Why This Approach?
- Avoids needing a separate build process for the handler
- The handler is embedded directly into the client build directory
- When the static file server Lambda is deployed, it uses this file as its entry point
- Lambda looks for a handler named "index.handler", which matches this output

### MIME Type Mapping
The injected handler includes MIME type mappings for:
- `.html` → text/html
- `.js` → application/javascript
- `.css` → text/css
- `.json` → application/json
- `.png/.jpg/.gif/.svg` → appropriate image types
- `.woff/.woff2` → font types

---

## Step 3: Build API Handler

```bash
node scripts/build-api-handler.cjs
```

### What It Does
Compiles the TypeScript API handler and packages it with all its dependencies into a format ready for Lambda deployment.

### Step-by-Step Process

#### 1. Create build/api directory
```javascript
const apiBuildDir = path.join(__dirname, '../build/api');
if (!fs.existsSync(apiBuildDir)) {
  fs.mkdirSync(apiBuildDir, { recursive: true });
}
```

#### 2. Compile TypeScript to JavaScript
```bash
tsc api-handler.ts --outDir build/api --module commonjs --skipLibCheck --target es2020 --resolveJsonModule --esModuleInterop
```
- Input: `api-handler.ts` (your source code)
- Output: `build/api/api-handler.js` (compiled JavaScript)

#### 3. Rename handler file
```javascript
fs.renameSync(apiHandlerPath, indexPath);
```
- From: `build/api/api-handler.js`
- To: `build/api/index.js`

**Why?** Lambda expects the handler file to be named exactly "index.js" (or matches the "handler" property in Terraform: "index.handler")

#### 4. Create temporary package.json
```javascript
{
  "name": "auth-app-api",
  "version": "1.0.0",
  "dependencies": {
    "jsonwebtoken": "^9.0.3",
    "jwks-rsa": "^3.2.1"
  }
}
```

#### 5. Install dependencies
```bash
npm install --production
```
- This runs in `build/api/` directory
- Downloads all dependencies and their transitive dependencies (e.g., `jws`, `semver`)
- Creates `build/api/node_modules/` with all packages needed at runtime
- `--production` flag excludes devDependencies

**Why this approach?** Lambda can't access npm registry at runtime, so all dependencies must be bundled in the zip file.

#### 6. Clean up temporary files
```javascript
fs.unlinkSync(packageJsonPath);
fs.unlinkSync(lockFilePath);
```
- Removes `package.json` and `package-lock.json` (not needed in Lambda)
- Keeps `node_modules/` (required for runtime)

### Output Location
- `build/api/index.js` - API handler (compiled from api-handler.ts)
- `build/api/node_modules/` - all dependencies and transitive dependencies

### Dependencies Installed
- `jsonwebtoken` - for JWT verification
- `jwks-rsa` - for fetching Auth0's public keys
- Transitive dependencies:
  - `jws` - JSON Web Signature implementation
  - `semver` - version parsing
  - (others as required by the above packages)

---

## Final Output Structure

After `yarn build` completes:

```
build/
├── client/
│   ├── index.js                    ← Static file server handler (INJECTED)
│   ├── index.html                  ← React app entry point
│   └── assets/
│       ├── _index-CjGoVtFd.js      ← Compiled React code
│       ├── chunk-EPOLDU6W.js       ← Code splitting chunks
│       ├── root-DhphxH0k.css       ← Compiled CSS
│       ├── manifest-a0bec702.js    ← Asset manifest
│       └── (other optimized assets)
├── api/
│   ├── index.js                    ← API handler (COMPILED)
│   └── node_modules/               ← Dependencies
│       ├── jsonwebtoken/
│       ├── jwks-rsa/
│       ├── jws/
│       ├── semver/
│       └── (others...)
└── server/
    └── index.js                    ← Server-side code (not used for Lambda)
```

---

## How Lambdas Use These Files

### Static File Server Lambda
- **Handler file:** `build/client/index.js`
- **Entry point:** `index.handler` (the exported function in index.js)
- **Deployment:** Terraform zips up `build/client/` and uploads to Lambda
- **At runtime:** Lambda reads files from `build/client/` (same directory as handler)

### API Lambda
- **Handler file:** `build/api/index.js`
- **Entry point:** `index.handler` (the exported function in index.js)
- **Dependencies:** `build/api/node_modules/` (must be in same directory)
- **Deployment:** Terraform zips up `build/api/` including node_modules and uploads to Lambda
- **At runtime:** Lambda can `require()` modules from `build/api/node_modules/`

---

## Design Rationale

### Single Command Orchestration
`yarn build` chains all three steps sequentially using `&&` operators. Each step depends on the previous one:
- Step 2 needs the `build/client/` directory created by Step 1
- Step 3 is independent but uses `build/api/` which it creates itself

If any step fails, subsequent steps don't run, preventing incomplete builds.

### Explicit Path Specifications

Each script knows where to output because paths are hardcoded:

**inject-handler.cjs:**
```javascript
const outputPath = path.join(__dirname, '../build/client/index.js');
```

**build-api-handler.cjs:**
```javascript
const apiBuildDir = path.join(__dirname, '../build/api');
```

This makes the build process deterministic and ensures files end up in the correct locations.

### No File Conflicts
- Static handler → `build/client/index.js`
- API handler → `build/api/index.js`
- Different directories prevent any conflicts

Each Lambda has its own separate handler file and dependency tree.

### Separation of Concerns
Two separate Lambdas serve two different purposes:
- **Static file server:** Public, no authentication required
- **API server:** Protected, requires JWT validation
- Each can be scaled and configured independently

---

## Deployment Flow

After build completes, deployment happens with:

```bash
cd infra
tofu apply -auto-approve
```

Terraform:
1. Zips `build/client/` → uploads to static file server Lambda
2. Zips `build/api/` (including node_modules) → uploads to API Lambda
3. Updates API Gateway routes
4. Applies any other infrastructure changes

---

## Common Issues & Solutions

### "Cannot find module 'jws'"
**Cause:** `npm install` didn't run or failed silently
**Solution:** Check `build/api/node_modules/` exists and contains `jws` subdirectory

### Handler not found in Lambda
**Cause:** Handler file named incorrectly (e.g., `api-handler.js` instead of `index.js`)
**Solution:** The rename step in build-api-handler.cjs fixes this automatically

### MIME type errors in browser
**Cause:** Static handler serving files with wrong content-type
**Solution:** The MIME type mapping in inject-handler.cjs handles all common file types

### React app 404 on refresh
**Cause:** Static handler not falling back to `index.html` for unknown routes
**Solution:** The inject-handler.cjs includes SPA fallback logic

---

## Key Takeaway

The build process is a **three-stage pipeline** that transforms:
1. **React source** → optimized static assets
2. **Static assets** → Lambda handler wrapped with HTTP functionality
3. **API source** → compiled Lambda handler with bundled dependencies

All three stages are coordinated by a single `yarn build` command, producing two separate Lambda deployments from a unified source tree.
