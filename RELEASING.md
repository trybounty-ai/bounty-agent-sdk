# Releasing packages

Every change to `@bounty-ai/agent-sdk` or `@bounty-ai/flue` that should reach
npm needs a Changeset:

```bash
pnpm changeset
```

Releases run through the **Release packages** workflow, which uses the
[`changesets/action`](https://github.com/changesets/action) sub-actions as in
the Changesets
[trusted publishing guide](https://changesets.dev/guide/automating). Every push
to `main` selects one of two modes:

- While Changesets are pending, the workflow opens or updates a draft
  **Version packages** pull request containing the version and changelog
  changes. Review and merge that pull request normally.
- Once no Changesets are pending, the workflow publishes the package versions
  that are not on npm yet and tags and releases the versions that have no git
  tag yet. Other merges publish nothing.

Run the workflow manually from `main` to retry a failed publish. If a version
reached npm but its tag or GitHub Release was not created, create them by hand;
neither a new run nor a re-run creates them for versions already on npm.

The version pull request is created with the GitHub App configured by
`RELEASE_APP_CLIENT_ID` and `RELEASE_APP_PRIVATE_KEY`, so it triggers the
normal pull-request CI.

Prerelease versions, such as `0.3.0-beta.0`, are published while in
prerelease mode and use the npm `beta` tag; other versions use `latest`. After
publishing, the workflow tags each package version, such as
`@bounty-ai/agent-sdk@0.2.0-beta.2`, and creates a GitHub Release whose notes
are that version's section of the package's `CHANGELOG.md`. Prerelease
versions are marked as prereleases.

The packages remain pre-1.0 while their public interfaces settle, so a minor
version can include breaking changes. To publish betas again, run
`pnpm changeset pre enter beta`; version pull requests then continue a
prerelease sequence until `pnpm changeset pre exit`.

## Job isolation

Release checks and package scripts run only in the unprivileged `pack` job,
which uploads the tarballs as an artifact. The `publish` job is attached to the
`npm` GitHub environment and is the only job with an OIDC token. It installs
dependencies with lifecycle scripts disabled, publishes the packed tarballs,
which pnpm does without running package scripts, and then creates the tags and
GitHub Releases. Repository write access exists only in that job and in the
`version` job through the GitHub App token.

## npm authentication

Both packages publish with npm trusted publishing and provenance. Do not store
an npm token in GitHub. Each package's npm trusted publisher is configured
with:

- GitHub owner: `trybounty-ai`
- Repository: `bounty-agent-sdk`
- Workflow: `publish.yml`
- Environment: `npm`
- Allowed action: `npm publish`

The publish job publishes through pnpm, which exchanges the OIDC token for npm
credentials. It sets `pnpm_config_provenance`, so a publish fails instead of
continuing without a provenance statement.
