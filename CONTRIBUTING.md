# Contributing

Thanks for considering a contribution. This is a small, owner-maintained project, so a quick issue to discuss a larger change before you build it saves everyone time.

## Agreement

Before a pull request can be merged you need to agree to the [Contributor Licence Agreement](CLA.md). You keep your copyright; the agreement lets the Maintainer relicense the project, for example to offer an extra edition, without asking each contributor. Agreeing takes one comment on your first pull request (the wording is in the agreement). The public project stays AGPL-3.0-or-later either way.

## Setting up

```bash
yarn install
yarn dev          # needs the Auth0 variables in CLAUDE.md, or use the self-hosted container (docs/SELF-HOSTING.md)
yarn typecheck
yarn test
```

`yarn build:demo` builds the browser demo with invented data and needs no credentials.

## Pull requests

- Keep each pull request to one change, and add or update tests for behaviour you change.
- Use conventional commit messages: `feat:`, `fix:`, `chore:`, `refactor:`, `test:`, `docs:`, imperative mood, under 72 characters.
- `yarn typecheck` and `yarn test` must pass; CI also runs a dependency audit and, for the container, a vulnerability scan.
- Follow the security controls in [SECURITY.md](SECURITY.md) (input validation at API boundaries, no secrets in code or logs).
- If a change affects a page shown on the About page, run `yarn screenshots` and commit the images.

## Reporting a security problem

Please do not open a public issue for a vulnerability. Use GitHub's "Report a vulnerability" option under the repository's Security tab.
