# Changelog

Releases of the self-hosted container image (`ghcr.io/kingchappers/budget-app-v3-ai-edition`). Versions follow `vX.Y.Z` tags; `edge` is the latest `main` and is not a release. See "Upgrading" in [docs/SELF-HOSTING.md](docs/SELF-HOSTING.md) before you update, and take a backup first.

## Unreleased

Not in the image yet, or not part of it:

- **Browser demo.** A separate static build of the app with an invented household, running entirely in the visitor's browser. It is published at https://demo.budget.scgrid.xyz and is not part of the container image.
- **Weekly image scan.** The published `latest` and `edge` images are scanned for high and critical vulnerabilities every Monday.

## 0.2.0 - 2026-10-17

Made the image workable on hosts that give you no shell, such as PikaPods.

- **Password recovery without a shell.** Create an empty file named `RESET_PASSWORD` in the data folder and restart. The app deletes it, signs everyone out, clears any login lock-out and logs a one-time recovery code (also saved as `SETUP_CODE.txt`). Entering that code on the sign-in page sets a new password; your account and data are unchanged.
- **Setup and recovery codes** appear in the log and in `SETUP_CODE.txt` (owner-only, removed once used).
- **`TRUST_PROXY`** accepts only `true` or `false`.
- Documentation for running on a managed host, including where to find the log and the data folder.
- Database schema: unchanged from 0.1.0.

## 0.1.0 - 2026-10-17

First release of the self-hosting image.

- The app and its API in one container for `linux/amd64` and `linux/arm64`, running as a non-root user.
- SQLite storage in `/data`, with an automatic daily backup.
- Built-in single-account login, so no Auth0 account is needed.
- Optional automatic HTTPS (set `TLS_DOMAIN`), or plain HTTP behind your own reverse proxy.
- Licensed AGPL-3.0-or-later.
