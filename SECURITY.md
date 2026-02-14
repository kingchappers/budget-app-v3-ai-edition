# Security Controls

Security requirements for this React + Auth0 + Lambda project. Reference control IDs in commits and reviews (e.g., "addresses AUTH-02").

---

## Quick Reference

**Before coding:** Review controls for your change type
**Before PR:** Run security checklist
**Before deploy:** Verify production config

---

## Authentication & Authorization (AUTH)

| ID | Framework Ref | Control |
|----|---------------|---------|
| AUTH-01 | WEB-A01, WEB-A07 | Validate JWT on every API request: signature, `aud`, `iss`, `exp`, `sub` |
| AUTH-02 | WEB-A07 | Never implement custom auth — delegate to identity provider (Auth0, Okta, etc.) |
| AUTH-03 | FE-02 | Use identity provider's in-memory token storage, not `localStorage` |
| AUTH-04 | WEB-A01 | Server-side access control required — hiding UI elements is not access control |
| AUTH-05 | WEB-A01 | Deny by default — explicit authorization required for all routes except public static files |
| AUTH-06 | WEB-A02, WEB-A07, WEB-A09 | Never log tokens, session IDs, or credentials |

**Framework mapping:** WEB-A01 (Broken Access Control), WEB-A07 (Auth Failures), FE-02 (Auth State)

**Key points:**
- Maintain separation between public function (static files) and protected function (API with JWT validation)
- Rate limit auth endpoints (WEB-A04)
- Handle token expiration gracefully in UI

---

## Input & Output (IO)

| ID | Framework Ref | Control |
|----|---------------|---------|
| IO-01 | WEB-A03, SANS-06 (CWE-20) | Validate all input at API boundaries: type, length, format, allowed values |
| IO-02 | WEB-A03 | Use allowlists for validation where possible |
| IO-03 | WEB-A03, SANS-05 (CWE-78) | Never pass user input to `eval()`, `Function()`, shell commands, or SQL |
| IO-04 | SANS-03 (CWE-89) | Use parameterized queries if adding database |
| IO-05 | WEB-A03 | Escape output contextually: HTML entities, URL encoding, JSON encoding |
| IO-06 | SANS-02 (CWE-79), FE-01 | Never use `dangerouslySetInnerHTML` without DOMPurify |
| IO-07 | API-01 | Reject requests with unexpected fields or content types |
| IO-08 | FE-04, SANS-08 (CWE-22) | Validate redirect URLs against allowlist (prevent open redirect) |

**Framework mapping:** WEB-A03 (Injection), SANS-02 (XSS), SANS-03 (SQL Injection), SANS-05 (Command Injection), SANS-06 (Input Validation), SANS-08 (Path Traversal)

**Key points:**
- React JSX escapes by default — don't bypass it
- Set `Content-Security-Policy` headers (WEB-A05)
- Generic error messages to clients, detailed logs server-side (API-02)

---

## Secrets & Credentials (SEC)

| ID | Framework Ref | Control |
|----|---------------|---------|
| SEC-01 | WEB-A02, IAC-04, CIS-03 | Never commit secrets to git: `.env`, API keys, credentials, state files |
| SEC-02 | WEB-A02, IAC-04 | Use environment variables or secrets manager for secrets |
| SEC-03 | IAC-04 | Set `sensitive = true` on IaC variables containing secrets |
| SEC-04 | IAC-07 | Encrypt IaC state at rest (object storage with encryption) |
| SEC-05 | FE-03 | Use build tool prefix (e.g., VITE_) only for values safe to expose in browser |
| SEC-06 | WEB-A02, WEB-A09, CICD-06 | Never log environment variables or request bodies that may contain secrets |
| SEC-07 | CIS-04 | Rotate credentials regularly (identity provider secrets, cloud API keys) |

**Framework mapping:** WEB-A02 (Cryptographic Failures), IAC-04 (Secrets Management), IAC-07 (State Management), CICD-06 (Credential Hygiene), CIS-03 (Secure Config), CIS-04 (Access Management)

**Key points:**
- `.gitignore` must cover: `.env*`, state files, `*.tfvars`, credentials files (CIS-03)
- Audit built JS bundle for accidentally included secrets (FE-03)
- Use OIDC federation in CI, not long-lived cloud provider keys (CICD-02)

---

## Infrastructure (INFRA)

| ID | Framework Ref | Control |
|----|---------------|---------|
| INFRA-01 | IAC-01, IAC-03 | Least privilege permissions — scope to specific resources, avoid wildcard grants |
| INFRA-02 | IAC-02 | Require source conditions on function permissions (prevent confused deputy) |
| INFRA-03 | IAC-01, CIS-02 | Enable encryption at rest for object storage, logs, and databases |
| INFRA-04 | IAC-08, IAC-09 | Set function timeout, memory, and concurrency limits |
| INFRA-05 | API-03, IAC-09 | Configure API gateway throttling (rate and burst limits) |
| INFRA-06 | WEB-A05 | Use `NODE_ENV=production` in deployed environments |
| INFRA-07 | WEB-A05 | Remove default credentials and sample code from production |
| INFRA-08 | IAC-01 | Tag resources with `Environment` and `ManagedBy` |
| INFRA-09 | IAC-10 | Run IaC plan command in CI to detect drift |
| INFRA-10 | IAC-10 | Never apply infrastructure changes manually |

**Framework mapping:** IAC-01 (Cloud Config), IAC-02 (Auth), IAC-03 (IAM), IAC-04 (Secrets), IAC-08 (Defaults), IAC-09 (Resource Boundaries), IAC-10 (Drift), WEB-A05 (Security Misconfiguration), CIS-02 (Data Protection)

**Key points:**
- All infrastructure changes go through version-controlled IaC (Terraform/OpenTofu/Pulumi)
- Explicit security settings — don't rely on provider defaults (IAC-08)
- Deny public object storage access by default (IAC-09)
- Enable log retention policies (IAC-06)

---

## Dependencies (DEP)

| ID | Framework Ref | Control |
|----|---------------|---------|
| DEP-01 | WEB-A06, CICD-03, CIS-05 | Run package audit before adding/updating dependencies |
| DEP-02 | WEB-A06 | Review new dependencies: maintenance status, download count, CVEs, transitive deps |
| DEP-03 | WEB-A06 | Pin dependency versions in package manifest |
| DEP-04 | WEB-A08, CICD-03 | Use lockfiles and verify in CI |
| DEP-05 | WEB-A06 | Never use dependencies with known critical/high CVEs in production |
| DEP-06 | WEB-A06, CIS-01 | Keep runtime versions current (language runtime, IaC providers, SDK libraries) |
| DEP-07 | CIS-01 | Remove unused dependencies from package manifest |

**Framework mapping:** WEB-A06 (Vulnerable Components), WEB-A08 (Integrity Failures), CICD-03 (Dependency Chain), CIS-01 (Software Inventory), CIS-05 (Secure Development)

**Key points:**
- Review transitive dependency changes in PRs that modify lockfiles
- Pin CI/CD actions to commit SHAs (CICD-08)
- Verify build artifact checksums before deployment (CICD-09)

---

## Logging & Monitoring (LOG)

| ID | Framework Ref | Control |
|----|---------------|---------|
| LOG-01 | WEB-A09 | Log authentication events: login, logout, token refresh, failures |
| LOG-02 | WEB-A09 | Log access control failures with context (IP, user agent, resource) |
| LOG-03 | WEB-A09 | Structure logs as JSON for parsing |
| LOG-04 | WEB-A02, WEB-A09, CIS-02 | Never log sensitive data: tokens, passwords, PII, full request bodies |
| LOG-05 | IAC-06 | Configure log retention appropriately |
| LOG-06 | WEB-A09 | Set up alarms for anomalies (spikes in 401/403, unusual API usage) |
| LOG-07 | CICD-10 | Log deployment events: who triggered, what deployed, which environment |

**Framework mapping:** WEB-A09 (Logging Failures), IAC-06 (Logging & Monitoring), CICD-10 (CI/CD Logging), CIS-02 (Data Protection)

**Key points:**
- Enable cloud audit logging for all API activity (IAC-06)
- Expand API gateway access log format to include method, path, status, latency (IAC-06)
- Retain CI/CD logs for audit purposes (CICD-10)

---

## CI/CD (CICD)

| ID | Framework Ref | Control |
|----|---------------|---------|
| CICD-01 | CICD-01 | Require PR approval before merging to main |
| CICD-02 | CICD-01 | Branch protection: no direct pushes to main, require status checks |
| CICD-03 | CICD-08, WEB-A08 | Pin CI/CD actions to commit SHAs, not mutable tags |
| CICD-04 | CICD-03, CIS-05 | Run package audit as required CI step |
| CICD-05 | CICD-05 | Use CI platform's `permissions` block per workflow/pipeline |
| CICD-06 | CICD-06 | Store secrets in CI platform's encrypted secrets, never in workflow files |
| CICD-07 | CICD-09 | Verify build artifact checksums before deployment |
| CICD-08 | CICD-04 | Review workflow file changes carefully — high-risk modifications |
| CICD-09 | CICD-01 | Separate build and deploy stages |
| CICD-10 | CICD-06 | Mask secret values in CI logs |

**Framework mapping:** CICD-01 (Flow Control), CICD-03 (Dependency Chain), CICD-04 (Pipeline Execution), CICD-05 (PBAC), CICD-06 (Credential Hygiene), CICD-08 (Third-Party Services), CICD-09 (Artifact Integrity), CICD-10 (Logging), WEB-A08 (Integrity Failures)

**Key points:**
- Validate workflow changes in PR reviews (CICD-04)
- Do not include dev dependencies, test files, or source maps in deployed artifacts (CICD-09)
- Use specific runner image versions, not `latest` (CICD-07)
- Apply least privilege to CI/CD service accounts (CICD-02)

---

## HTTP Security Headers (HTTP)

**Framework:** WEB-A05 (Security Misconfiguration)

Configure on all responses:

```
Content-Security-Policy: default-src 'self'; script-src 'self'; ...
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Strict-Transport-Security: max-age=31536000; includeSubDomains
Referrer-Policy: strict-origin-when-cross-origin
```

- Restrict CORS — no `allow_origins: ["*"]` in production (WEB-A05)
- Enforce HTTPS/TLS for all endpoints (WEB-A02)
- Disable verbose error messages in production (WEB-A05, API-02)
- Set `Content-Type: application/json` on API responses (API-02)

---

## Pre-PR Security Checklist

Run before creating a PR:

- [ ] Package audit passes (no critical/high vulnerabilities) — **DEP-01**
- [ ] No secrets in code, logs, or environment variable references — **SEC-01, SEC-06**
- [ ] User input validated at API boundaries — **IO-01**
- [ ] JWT validation on all protected endpoints — **AUTH-01**
- [ ] Server-side access control enforced — **AUTH-04**
- [ ] Error messages generic to clients, detailed server-side — **API-02**
- [ ] `.gitignore` updated if new sensitive files added — **SEC-01**
- [ ] Security headers configured if adding new endpoints — **HTTP**
- [ ] Cloud permissions scoped to specific resources — **INFRA-01**
- [ ] IaC changes reviewed with plan command — **INFRA-09**

---

## Framework Reference Guide

| Prefix | Source |
|--------|--------|
| WEB-A## | [OWASP Top 10 Web Applications (2021)](https://owasp.org/Top10/) |
| CICD-## | [OWASP Top 10 CI/CD Security (2023)](https://owasp.org/www-project-top-10-ci-cd-security-risks/) |
| IAC-## | [OWASP Infrastructure as Code Security](https://owasp.org/www-project-infrastructure-as-code-security/) |
| CIS-## | [CIS Controls v8](https://www.cisecurity.org/controls) |
| SANS-## | [SANS Top 25 (CWE)](https://www.sans.org/top25-software-errors/) |
| FE-## | Frontend-Specific Controls |
| API-## | API-Specific Controls |

### Detailed Framework Mapping

**OWASP Web Top 10 (2021):**
- A01: Broken Access Control → AUTH controls
- A02: Cryptographic Failures → SEC controls
- A03: Injection → IO controls
- A04: Insecure Design → AUTH-05, INFRA-05
- A05: Security Misconfiguration → HTTP, INFRA-06, INFRA-07
- A06: Vulnerable Components → DEP controls
- A07: Auth Failures → AUTH controls
- A08: Integrity Failures → DEP-04, CICD-03, CICD-07
- A09: Logging Failures → LOG controls
- A10: SSRF → (validate outbound URLs if implemented)

**SANS Top 25 (CWE):**
- CWE-79 (XSS) → IO-06, FE-01
- CWE-89 (SQL Injection) → IO-04
- CWE-78 (Command Injection) → IO-03
- CWE-20 (Input Validation) → IO-01
- CWE-22 (Path Traversal) → IO-08
- CWE-352 (CSRF) → Mitigated by Bearer token auth
- CWE-434 (File Upload) → (validate if implemented)
