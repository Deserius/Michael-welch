# CI is not installed yet

`ci.yml` is present in this folder but **could not be pushed** by the Arena
GitHub integration — it authenticates as a GitHub App without the `workflows`
permission, and GitHub rejects any push that creates or edits a file under
`.github/workflows/`.

## To enable it

Pick either route:

1. **Grant `workflows` scope** to the GitHub connection in Arena, then push
   this branch again.
2. **Paste it in manually** — open
   `.github/workflows/ci.yml` on this branch, click *Add file → Create new
   file*, and use that content at the same path in the GitHub UI.

The workflow runs the same checks that pass locally today:

```bash
npm ci
npm run typecheck
npm run lint
npm test
npm run build
```
