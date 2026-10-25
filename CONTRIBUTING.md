# Contributing

Thanks for considering a contribution. This is a small, owner-maintained project, so a quick issue to discuss a larger change before you build it saves everyone time.

## Agreement

Before a pull request can be merged you need to agree to the [Individual Contributor License Agreement](CLA.md), which is with Samuel Chapman, trading as Hoardwise Studios. It is the standard Harmony agreement: you keep your copyright, and you grant a licence that lets the project be offered under other terms as well, for example in an extra edition, without asking each contributor. The public project stays AGPL-3.0-or-later either way. Agreeing takes one comment on your first pull request (the wording is in section 7 of the agreement). If you contribute as part of your job, make sure your employer is happy with that first.

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
