# Releasing packages

Every change to `@bounty-ai/agent-sdk` or `@bounty-ai/flue` that should reach
npm needs a Changeset:

```bash
pnpm changeset
```

After the change reaches `main`, the **Version packages** workflow opens or
updates a draft pull request containing the version and changelog changes.
Review and merge that pull request normally.

GitHub Actions must be allowed to create pull requests in the repository
settings. The workflow uses the built-in token by default. Set
`RELEASE_GITHUB_TOKEN` to a bot or GitHub App token if version pull requests
must trigger the normal pull-request CI automatically.

Merging the version pull request publishes the new versions. The **Publish
packages** workflow runs when a package's `package.json` changes on `main` and
publishes only versions that are not already on npm, so other merges publish
nothing. To inspect packages without publishing, run the workflow manually from
`main`; manual runs default to a dry run. Releases use the npm `beta` tag, so
they do not replace `latest`.

After publishing, the workflow tags each package version, such as
`@bounty-ai/agent-sdk@0.2.0-beta.2`, and creates a GitHub Release whose notes
are that version's section of the package's `CHANGELOG.md`. Prerelease
versions are marked as prereleases. Re-running the workflow skips existing
tags and Releases.

The packages remain pre-1.0 while their public interfaces settle. Changesets is
in `beta` prerelease mode, so version pull requests continue the prerelease
sequence instead of promoting a package to a stable release. Leave prerelease
mode only when the packages are ready for stable versions.

The publish job is attached to the `npm` GitHub environment. Configure that
environment with required reviewer approval before the first release.

Release checks and package scripts run in an unprivileged preparation job. The
workflow transfers checksummed tarballs to a minimal OIDC publishing job, which
publishes with lifecycle scripts disabled. Repository write access exists only
in the final tag job and is not available while dependencies or package scripts
run.

## npm authentication

`@bounty-ai/agent-sdk` already exists on npm and can use trusted publishing now.
Configure its npm trusted publisher with:

- GitHub owner: `trybounty-ai`
- Repository: `bounty-agent-sdk`
- Workflow: `publish.yml`
- Environment: `npm`
- Allowed action: `npm publish`

An npm package must exist before trusted publishing can be configured.
`@bounty-ai/flue` therefore needs a one-time local bootstrap release from an
audited tarball using interactive npm authentication and 2FA. Do not store an
npm token in GitHub. After that first release, configure the same trusted
publisher for Flue and log out of the temporary npm session.

The workflow publishes through the npm CLI, which supports OIDC and automatic
provenance. pnpm is still used to create each tarball so workspace dependency
ranges are converted correctly before publication.

## Deferred

- Consider publishing through `changesets/action`, which creates tags and
  GitHub Releases itself and would replace this repository's custom publish
  steps. Adopt it only if it can keep the current isolation:
  npm publishing in a minimal OIDC job with lifecycle scripts disabled, and
  repository write access only in the final tag job. Until then, the tag job
  creates the same Releases with `gh release create`.
