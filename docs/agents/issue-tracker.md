# Issue tracker: GitHub

Issues and specs for this repo live as GitHub issues in `RoCTH01/PinRef`. Use the `gh` CLI for all operations and pass `--repo RoCTH01/PinRef` so commands work regardless of the local remote configuration.

## Conventions

- **Create an issue**: `gh issue create --repo RoCTH01/PinRef --title "..." --body "..."`.
- **Read an issue**: `gh issue view <number> --repo RoCTH01/PinRef --comments`, also fetching labels when structured output is needed.
- **List issues**: `gh issue list --repo RoCTH01/PinRef --state open --json number,title,body,labels,comments` with appropriate label and state filters.
- **Comment on an issue**: `gh issue comment <number> --repo RoCTH01/PinRef --body "..."`.
- **Apply or remove labels**: `gh issue edit <number> --repo RoCTH01/PinRef --add-label "..."` or `--remove-label "..."`.
- **Close an issue**: `gh issue close <number> --repo RoCTH01/PinRef --comment "..."`.

## Pull requests as a triage surface

**PRs as a request surface: no.**

## When a skill says "publish to the issue tracker"

Create a GitHub issue in `RoCTH01/PinRef`.

## When a skill says "fetch the relevant ticket"

Run `gh issue view <number> --repo RoCTH01/PinRef --comments`.

## Wayfinding operations

- **Map**: one issue labelled `wayfinder:map` containing Notes, Decisions-so-far, and Fog.
- **Child ticket**: a GitHub sub-issue, or a task-list child when sub-issues are unavailable. Use a `wayfinder:<type>` label.
- **Blocking**: prefer GitHub's native issue dependencies; fall back to a `Blocked by: #<n>` line.
- **Frontier**: choose the first open, unblocked, unassigned child in map order.
- **Claim**: assign the issue to the current user before starting work.
- **Resolve**: comment with the answer, close the issue, and add a context pointer to the map.
