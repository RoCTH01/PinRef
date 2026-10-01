# PinRef

A Chrome MV3 extension that adds a private, local-first metadata layer (Tags, Notes, Trash) to Pinterest References. Pinterest keeps discovery, native Save and Boards; PinRef never mirrors or mutates them.

## Before changing behavior

Read `CONTEXT.md` and every ADR in `docs/adr/` that touches the area. Use glossary terms exactly in code, tests, UI strings, issues and specs, and avoid the terms each entry lists under _Avoid_. When a needed concept is missing from the glossary, flag it for `/domain-modeling` rather than inventing a synonym.

"Inspector" is the PinRef surface; Chrome's Side Panel is only the container a Docked Inspector lives in. Older documents say "Side Panel" where they mean the Inspector on Pinterest (ADR-0013).

When proposed work contradicts an ADR, name the conflict and ask; never override an ADR silently.

## Which document wins

Product truth is spread across `CONTEXT.md`, `docs/adr/`, `docs/product/crud-decisions.md` (Chinese), `docs/specs/` and `extension/README.md`. When they disagree, the most recently dated statement wins: ADRs carry `Revised on YYYY-MM-DD`, product docs carry `最後更新`, otherwise use `git log`. If dates tie or are missing, ask the user. When you change a decision, update its date and fix the older documents it supersedes.

`docs/archive/` is historical background only. `docs/research/` records investigations, not decisions.

## Layout

- `extension/`: the shipped extension; load it unpacked. Its README describes current product behavior and verification.
- `test/`: `node --test` suites. `scripts/`: Playwright browser checks and the shared browser fixture.
- `prototype/`: frozen reference for the intended UX. Read it for interaction details; leave it unchanged and keep its sample data, simulated outcomes and Dashboard-owned Import out of production code.

## Code

- Module format is provisional. Today `extension/` modules are UMD-style so one file loads through `importScripts` in the classic service worker and through `require` in Node tests; content scripts are self-contained IIFEs injected with `chrome.scripting.executeScript`. Follow this pattern when extending existing modules, and expect a later refactor (native ESM, or a bundler with TypeScript) as the project scales. Raise build or runtime-dependency changes with the user first.
- Write readable, conventionally formatted code like `extension/import/domain.js`. Reformatting dense code is welcome inside the code you are already changing.
- All local mutations go through the worker's serialized command queue with field and lifecycle revisions (ADR-0006, ADR-0008).
- Write code, UI strings, `CONTEXT.md`, ADRs and issues in English. Reply to the user in their language.

## Done means

- `npm test` and `npm run typecheck` pass (typecheck is syntax-only).
- `npm run test:browser` also passes when `sidepanel/`, `dashboard/`, `content/` or `library/ui.js` changed. If Playwright's bundled Chromium is missing, point `PINREF_BROWSER` at an installed Chrome (macOS: `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`) instead of downloading browsers.
- Browser checks load pages from `file://`, where `postMessage` origins are `"null"`; code that checks origins needs the same `file:` allowance `panel.js` and `dashboard.js` use.
- Fixture and browser checks never establish real-Pinterest behavior. Report the signed-in Chrome/Pinterest matrix in `extension/README.md` as unvalidated rather than claiming it.

## Issues

Issues and specs live in GitHub `RoCTH01/PinRef`; see `docs/agents/issue-tracker.md` for `gh` conventions and `docs/agents/triage-labels.md` for triage labels.

## Domain docs

Single-context project: `CONTEXT.md` at the root, ADRs in `docs/adr/`.
