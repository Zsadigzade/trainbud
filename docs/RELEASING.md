# Releasing

## How a release happens

1. Bump `version` in `package.json`, update `CHANGELOG.md`, commit.
2. `git tag -a vX.Y.Z -m "vX.Y.Z"` and `git push origin vX.Y.Z`.
3. `.github/workflows/publish.yml` runs typecheck, build, test and lint, publishes to
   npm over OIDC, and cuts a GitHub release.
4. **Check the run.** `gh run list --workflow=publish.yml`. A tag-triggered workflow
   reports to nobody: if it fails, nothing turns red anywhere you are looking, and the
   only symptom is a version that never appears on the registry.

## Testing the release path without spending a version

`workflow_dispatch` runs the same workflow against `main`. Because the current version is
already on the registry, the publish step ends with

```
npm error You cannot publish over the previously published versions: X.Y.Z
```

**That is the pass condition.** The registry only reaches its version check after it has
accepted the identity, so reaching it proves OIDC authenticated. An authentication
failure looks nothing like it (`ENEEDAUTH`, `EOTP`, or a 403). Run this after any change
to `publish.yml`, the workflow filename, or the npm trusted-publisher settings —
confirmed working this way on 2026-09-06.

## Why there is no npm token

There used to be one, in `secrets.NPM_TOKEN`, and it stopped being a workable design:

- Classic tokens were revoked by npm in February 2026.
- Granular tokens with **Bypass 2FA** lost sensitive package-management actions in
  **early August 2026**, and creating a package is one of them. Their direct-publish
  ability is scheduled to go away entirely around **January 2027**.

So the replacement is [trusted publishing](https://docs.npmjs.com/trusted-publishers):
npm authenticates this repository and this workflow file directly over OIDC, and no
long-lived credential exists to leak or expire. Two things it needs, both easy to lose
in a refactor:

- **`permissions: id-token: write`** in the workflow. Without it there is no OIDC token,
  npm looks for a credential that is not there, and the error names authentication
  rather than the missing permission.
- **npm >= 11.5.1.** Node 22 ships npm 10, which ignores OIDC entirely, so the workflow
  upgrades npm — **after `npm ci` and the tests, not before**. Upgrading first left
  `better-sqlite3` with no compiled bindings and failed 133 tests while `ci.yml` stayed
  green on the same commit. Only `npm publish` needs the newer npm.

The trusted publisher is configured at
**npmjs.com → Packages → trainbud → Settings → Trusted publishing**, pinned to
`Zsadigzade/trainbud` and the workflow filename `publish.yml`. **Renaming this file
breaks publishing** — update the npm setting in the same change.

## The first publish of a new package cannot use OIDC

A trusted publisher is configured on a package's settings page, and a package that has
never been published has no settings page. npm's own guidance is to publish the first
version by hand and wire OIDC afterwards. `trainbud@0.5.0` was published that way on
2026-09-06 (`npm login`, then `npm publish --access public`, confirmed with a security
key in the browser). Every version after it goes through CI.

If a second package is ever split out of this repo, expect the same one-time manual step.

## Verifying a release actually landed

A green workflow is not proof the registry served it. From a directory that is not this
repo:

```bash
npm view trainbud version
npx --yes trainbud@X.Y.Z --version
```

The second one is the real check: it resolves, downloads and executes the published
artifact, which is what a reader of the README will do.
