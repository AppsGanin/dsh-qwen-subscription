# Contributing

Thanks for taking a look. Two rules keep the automation working.

## Commit messages decide the version

Releases are automated with [semantic-release](https://semantic-release.gitbook.io/), so the
commit message is the release note and the bump type:

| Prefix | Effect |
|---|---|
| `fix:` | patch — `0.1.0` → `0.1.1` |
| `feat:` | minor — `0.1.0` → `0.2.0` |
| `feat!:` / `BREAKING CHANGE:` | major — `0.1.0` → `1.0.0` |
| `docs:`, `test:`, `ci:`, `chore:`, `refactor:` | no release on their own |

Write the subject in the imperative mood (`add`, not `added`), keep the body for the
*why*, and put a `BREAKING CHANGE:` footer when the change requires action from users.

## What happens on merge to `main`

`Release` workflow: `npm ci` → `npm test` → `semantic-release`, which computes the next
version, prepends `CHANGELOG.md`, tags `vX.Y.Z`, publishes to npm and opens a GitHub Release.
`CI` workflow: the same offline suites run on every push and pull request.

Do not edit `version` in `package.json` or `CHANGELOG.md` by hand — both are written by the
release run. Publish credentials come from npm trusted publishing (OIDC); see the setup notes
in the repository discussion or ask the maintainer.
