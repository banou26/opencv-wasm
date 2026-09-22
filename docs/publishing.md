# Publishing @banou/opencv-wasm

[The publish workflow](../.github/workflows/publish.yml) follows Osra's release
model: push a new package version to `main`, pass the checks, publish to npm, then
create a `v<version>` GitHub release. It does not bump versions automatically.

## What runs

Pushes to `main` and pull requests build the pinned OpenCV 5 / contrib sources and
CPU dependencies in Docker, generate the TypeScript package, and run the type,
Node, Chromium and installed-package tests. The tested tarball and its SHA-256
checksum are retained as an Actions artifact for 14 days.

The native build uses three compile jobs on Ubuntu 24.04 with Node 24. Source
downloads and native build directories are cached against the build scripts and
Docker inputs. The first build is a full native compilation and takes longer.

After a successful build on `main`, a separate job checks whether that exact
version is already on npm. Existing versions are skipped; registry outages fail
the job. New versions are published from the tested archive using npm trusted
publishing, with public access and provenance. The release job attaches the same
archive and checksum to the published commit's GitHub release.

Pull requests and fork repositories do not publish. A manual run always builds
and tests; publishing requires selecting `main` and checking the `publish` input.
There is no option to bypass tests.

## One-time npm setup

A new npm package needs an initial publication before its trusted publisher can
be configured. Run the workflow manually with `publish` unchecked and download
the `npm-package-<commit>` artifact from the successful run. Extract the artifact
ZIP, then publish its tarball once with your npm account:

```sh
sha256sum --check banou-opencv-wasm-0.0.6.tgz.sha256
npm login
npm publish ./banou-opencv-wasm-0.0.6.tgz --access public --ignore-scripts --registry https://registry.npmjs.org
```

Use the actual archive version if it differs. Publishing the existing tarball
preserves the bytes tested by CI and does not require rebuilding locally. Follow
any npm account or two-factor prompts during this initial publication.

In the npm package's **Settings > Trusted Publisher**, select **GitHub Actions**:

| Field | Value |
| --- | --- |
| Organization or user | `banou26` |
| Repository | `opencv-wasm` |
| Workflow filename | `publish.yml` |
| Environment name | Leave empty |
| Allowed actions | Enable direct `npm publish` |

These values must match exactly, including the lowercase owner. No `NPM_TOKEN`
GitHub secret is needed. The publish job uses a GitHub-hosted runner and grants
`id-token: write`; npm exchanges that identity for publication credentials. See
[npm's trusted publishing documentation](https://docs.npmjs.com/trusted-publishers/).

The initial manual publication does not create a GitHub release automatically.
Later versions published by the workflow do.

## Subsequent releases

After the release's changes are ready, update both manifests together:

```sh
npm version patch --no-git-tag-version
```

Commit `package.json` and `package-lock.json` with the release changes and push to
`main`. The workflow builds and tests that commit, publishes the new version and
creates its tag and release. If publishing fails after the build succeeds, fix
the npm configuration and rerun the failed jobs to reuse the tested artifact.

The website consumes a pinned npm package when no local `lib/` build exists, and
splits WASM into smaller assets for Cloudflare Pages. This workflow publishes the
npm package; configure the website separately using the
[Pages build settings](../website/README.md#cloudflare-pages).
