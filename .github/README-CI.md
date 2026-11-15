# CI is not installed yet

`ci/ci.yml` is ready to go, but **it could not be pushed to
`.github/workflows/ci.yml`** — the Arena GitHub integration authenticates as a
GitHub App without the `workflows` permission, and GitHub rejects any push that
creates or edits a file under `.github/workflows/`.

That single restriction is why the file sits in `ci/` instead.

## To enable it

Pick either route:

1. **Grant `workflows` scope** to the GitHub connection in Arena, then push
   this branch again after moving `ci/ci.yml` to `.github/workflows/ci.yml`.
2. **Paste it in manually** — open `ci/ci.yml` on this branch, create
   `.github/workflows/ci.yml` in the GitHub UI, and copy the content across.

The workflow runs exactly the checks that pass locally today:

```bash
npm ci
npm run typecheck
npm run lint
npm test
npm run build
```
