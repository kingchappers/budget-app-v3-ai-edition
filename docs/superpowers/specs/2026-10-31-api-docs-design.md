# API documentation inside Hoardwise (HOA-9 and HOA-50)

## Why

`docs/openapi.yaml` (HOA-7) describes every route, and the Hoardwise skill (HOA-8) teaches an agent the basics. But a person who wants to use the API for their own script, or to build an agent, has nowhere readable to go, and an agent that has only an instance URL and a token cannot discover the API. HOA-9 asks for a generated agent reference; HOA-50 asks for the docs to be easy to find and read. They are one piece of work.

## Who it is for

1. People using the API for their own purposes, such as a self-hoster with a script.
2. People building an agent that uses Hoardwise.
3. An agent reading the docs itself.

## Goals

- **For agents and tools:** two authenticated, read-only routes.
  - `GET /api/openapi.json`: the spec as JSON.
  - `GET /api/docs/agents`: a compact markdown reference (this is HOA-9's `agents.md`), grouped by topic, listing each operation's method, path, token access, parameters, request fields and responses, with an overview of amounts, dates, the type glossary, errors and token rules.
  - A read token can call both. An agent given only the instance URL and a read token can discover the whole API.
- **For people:** a "Docs" page inside the app that fetches the spec with the user's login and renders it with Mantine, in Hoardwise's calm style. It opens with a short getting-started: create a token under Settings > Access tokens, set the `Authorization` header, make a first call. Operations are grouped by topic and collapsed by default, so the page is not a wall of text.
- **Always the version that is running:** both routes serve files generated from `docs/openapi.yaml` and bundled into the API, so the docs match the API that is answering. They work the same on AWS and in the container.
- **No drift:** CI fails if the generated files are stale, or if the docs routes are missing from the spec.
- **HOA-50's remaining items:** the README and the self-hosting doc point to the in-app Docs page and the spec on GitHub. (HEAD was fixed in HOA-45, so the docs need not mention a limitation.)

## Non-goals

- A public docs site, or anything in the demo (docs are for logged-in users only, as with Settings > Access tokens).
- A "try it" console that calls the API from the page.
- Embedding a third-party viewer (Scalar, Redoc, Swagger UI).
- Versioned docs for older releases.
- Changing any API behaviour beyond the two new routes.

## Anti-goals

- Anyone without a valid login, session or token being able to fetch the docs from an instance.
- A long, overwhelming page: everything open at once, dense tables, walls of JSON.
- Docs that describe an API other than the one running.
- Third-party scripts or styles loaded by the page.
- Anything that could contain real user data in the generated files (examples are invented).
- The page rendering spec text as HTML (it must be text, never markup).

## Design

**Generation.** A script reads `docs/openapi.yaml` and writes two committed files, `src/api/generated/openapi.json` and `src/api/generated/agents.md`, plus a `yarn docs:generate` command. A test regenerates them in memory and fails if the committed files differ, the same way the screenshots are kept current. Committing them means `yarn dev`, the tests and every build path work with no build-order step. Both builds already use `tsc --resolveJsonModule`, which copies imported JSON into the output; the markdown is imported as a string from a generated `.ts` module if JSON-only is simpler. The builder confirms the Lambda build, the container build and the tests.

**Routes.** Two handlers in `src/api/docs.ts`, registered as core routes so tokens (read scope) and sessions both reach them, and documented in the spec like every other route (`x-token-access: read`). Responses carry the usual security headers; `agents` is `text/markdown; charset=utf-8`; both are `Cache-Control: private` because they are authenticated. Because they are core routes they inherit the existing authentication, rate limiting and HEAD behaviour. The contract test needs a small extension to accept a markdown response.

**The page.** `app/routes/docs.tsx` at `/docs`, linked from Settings and hidden in the demo. It fetches `/api/openapi.json` with `useProtectedApi`. A small renderer of our own (Mantine Accordion and `Code` blocks; no markdown library is installed) shows:
- the getting-started panel;
- one collapsed section per tag, each listing its operations: method (as text, never colour alone), path, summary, token access;
- an operation opens to show its description, parameters, request body and response fields as short property lists, with the spec's examples in code blocks and a "copy" button for the example `curl`;
- a filter box.

Text from the spec is rendered as text. Backtick spans and paragraphs are supported by a tiny inline renderer; the builder checks which markdown the spec actually uses and supports no more than that. No raw HTML is ever set. Dark mode, WCAG AA and reduced motion follow `docs/brand.md`.

**Security.** The routes are authenticated like every other API route (SECURITY.md AUTH-01, AUTH-04, AUTH-13). They expose only the route list, which is also public in the open-source repo. SECURITY.md gets one line noting the docs routes, their token scope and that the generated files contain no user data.

## Tests

1. The committed generated files equal freshly generated output.
2. `agents.md` mentions every operation in the spec and states pence, the date formats, the glossary and the token rules.
3. The new routes are in the spec; route parity, token-access parity and the contract test pass; the contract test covers the markdown response and 401/403 for no credential.
4. Both routes answer 401 without a credential and 200 with a session or a read token.
5. Renderer tests: sections and operations render; a spec string containing `<script>` renders as text; methods appear as text; collapsed by default; the filter works; a copy button exists.
6. The Settings link is hidden in the demo; the `/docs` route shows nothing sensitive offline.
7. Screenshots: `yarn screenshots` is re-run only if the Settings page changes visibly (the link row), as `docs/brand.md` requires.

## Decisions

**Yours:** the three audiences; docs generated from the spec, with an agent markdown reference (HOA-9); gated to logged-in users only; a Mantine page of our own, not an embedded viewer.

**Mine, for you to check:** the route names (`/api/openapi.json`, `/api/docs/agents`, `/docs`); committing the generated files with a staleness test, instead of generating at build time; placing the page under Settings; collapsed by default with a filter box; a copy button for example `curl`; no "try it" console; reading tokens may fetch the docs; `Cache-Control: private`.

## Left open for the plan

- Exactly which markdown the spec uses, and so what the inline renderer supports.
- How to keep the page responsive on a phone.
- Whether the Hoardwise skill's `reference.md` should mention `GET /api/docs/agents` as the place to look beyond its cheat sheet. This would be a small follow-up, with a plugin version bump.

## Related

HOA-7 (the spec), HOA-8 (the skill), HOA-45 (HEAD, done), HOA-9, HOA-50.
