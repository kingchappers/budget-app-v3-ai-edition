# Hosted Readiness Design

Date: 2026-10-17. Sub-project of the self-hosting work, after Storage Interface, Portable Auth and Container Image (all merged; `v0.1.0` is published at `ghcr.io/kingchappers/budget-app-v3-ai-edition`). Goal: someone with no shell can run the image on a managed container host (PikaPods is the target) and recover from a forgotten password.

## Context

A managed host gives its users an image, environment variables, a persistent folder (a file manager) and a log viewer. On PikaPods that is the pod's **More > Show Logs** and its **Files** page. It gives no shell and no `docker exec`. Today:

- The first-run setup code is printed to the log only (`createLocalProvider`, `src/auth/local.ts`).
- Password recovery needs `store-cli reset-password`, which needs a shell.
- `POST /api/auth/setup` answers 409 once an account exists, so the setup screen cannot be reused for recovery.
- Plain HTTP behind a TLS-terminating proxy (`TRUST_PROXY`, `APP_ORIGIN`) is supported but never exercised by the smoke tests, and the docs do not describe a managed host.

## Scope

1. A prominent setup-code log block, plus `/data/SETUP_CODE.txt`.
2. Marker-file password recovery (`/data/RESET_PASSWORD`).
3. Host-neutral wording on the setup, recovery and login screens.
4. A `--proxy` smoke run and a "Running on a managed host" section in `docs/SELF-HOSTING.md`.

## Non-goals

Email-based reset (needs SMTP), a preset-code environment variable, a recovery endpoint reachable without file access, push reminders, multi-user, Demo Mode, any central service or telemetry (monetisation rules). `store-cli reset-password` stays for people with a shell.

## Design

### 1. Setup code: log block and file

The container (not `src/auth`) owns file access, so `createLocalProvider(env, hooks?)` takes optional hooks: `announceCode(code, kind)` and `retireCode()`. With no hooks it behaves as today (one log line, no file), so the Lambda and other callers are unchanged.

When the container announces a code (`kind` is `setup` or `recovery`) it:

- Prints one boxed block to stdout: a header line naming the kind, the code on its own line, and "open your app and enter this code". The code appears nowhere else in the log.
- Writes the same code to `<DATA_DIR>/SETUP_CODE.txt`, mode `0600`, written to a temporary name in the same directory and renamed into place. If the write fails it logs a warning that names the failure but not the code, and carries on (the log block still works).
- Deletes the file when the code is used, and at start-up when no setup or recovery is pending (a stale file never holds a dead code), and at graceful shutdown.

### 2. Marker-file recovery

At start-up, after the store is open and before `listen`, the container runs a recovery step:

1. Look for `<DATA_DIR>/RESET_PASSWORD` with `lstat`. Only a regular file counts; a directory or symlink is ignored with a warning. Contents are never read or logged.
2. No marker: nothing happens.
3. Marker but no account: delete the marker and continue with the normal first-run flow.
4. Marker and an account:
   - Delete the marker first. If the delete fails, log the error and **do not open recovery** (fail closed), so a marker that cannot be removed cannot re-arm recovery on every restart.
   - End every session and clear the login throttle (the same effects as `reset-password`).
   - Generate a one-time recovery code, held in memory only, and announce it (`kind: recovery`).

`POST /api/auth/setup` gains a second mode. While a recovery code is open and an account exists, a request with the right code and a valid new password (same `validatePassword` rules) replaces the password on the **existing** account (`replacePassword`), ends all sessions again, clears the code, retires the file and signs the user in. The user id, email and all data are untouched. Without an open recovery code the route still answers 409 for an existing account. A wrong or missing code answers 403, as today. No recovery state survives a restart: restarting without a fresh marker closes it.

`GET /api/auth/status` keeps `setupRequired` and adds `recoveryOpen: boolean` (true only while recovery is open).

### 3. Screens

- First-run setup: "Your setup code is in your host's logs (on PikaPods: pod menu, then Show Logs) or in the file `SETUP_CODE.txt` in your data folder." No mention of `docker compose`.
- Recovery (shown when `recoveryOpen`): same form with only code and new password, titled "Set a new password".
- Login: a short "Forgot your password?" hint linking to the docs section. It shows no state and calls no API.

### 4. Proxy-mode smoke run and docs

`scripts/container-smoke.mjs --proxy` runs the image in plain HTTP with `TRUST_PROXY=1` and `APP_ORIGIN=https://<host>`. It asserts that, with `X-Forwarded-Proto: https` and `X-Forwarded-For` sent:

- the `__Host-` session cookie carries `Secure`,
- the logged client address is the forwarded one,
- an Origin matching `APP_ORIGIN` is accepted and any other is rejected.

It also runs the recovery flow end to end: create the marker, restart, read the code from the log, set a new password, then confirm the old password and old sessions are rejected and the data is intact. CI runs `--proxy` after the plain and TLS runs.

`docs/SELF-HOSTING.md` gets "Running on a managed host": image and port 8080, the folder to mount at `/data`, the variables to set (`TRUST_PROXY`, `APP_ORIGIN`, `COOKIE_SECURE` where needed), where the setup code appears, how to recover a password, that **push reminders are not available** in the container, and that backups are in `/data/backups` and can be downloaded from the host's file manager. The existing "Forgot your password" section keeps the CLI route and links to the marker route first.

## Security

- Recovery requires write access to `/data`, which already implies full control of the database, so it adds no new trust boundary and no new network-reachable endpoint beyond the existing setup route.
- The recovery code uses the existing `SetupCode` class (72-bit random, constant-time comparison, in memory, cleared on use). The file copy is `0600` and short-lived.
- The marker is deleted before recovery opens; failure to delete fails closed.
- Existing sessions end when recovery opens, so a stolen session cannot outlive a recovery.
- New controls go in `SECURITY.md` as AUTH-11 (recovery marker) and an addendum to AUTH-07/08 for the code file, and are referenced from the commits.

## Testing

- Unit: marker handling (absent, file, directory, symlink, delete failure, no account), code file lifecycle (write, mode, rename, removal on use, stale cleanup, write failure still logs), the two setup modes (recovery success, wrong code, no recovery open still 409, password rules), session and throttle clearing, `recoveryOpen` in status.
- Component tests for the three screens' wording and the `recoveryOpen` form.
- Smoke: the `--proxy` run above in CI.
- Not verified until a real host: the PikaPods log and file views (their wording is taken from their documentation, not tried).

## Review focus

1. A marker that cannot be deleted must not leave recovery re-arming on each restart.
2. A directory or symlink named `RESET_PASSWORD` must not trigger recovery or crash start-up.
3. A write failure for `SETUP_CODE.txt` (read-only mount, full disk) must not stop the server or leak the code into the error.
4. A crash between opening recovery and finishing it must leave no usable code on disk after the next start.
5. Recovery must not change the email, the user id or any data, and must end sessions both when it opens and when it completes.
