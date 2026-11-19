## What changes

<!-- What a Buzz user sees, then how it works. -->

## Checks

- [ ] `npm run check` passes (CI runs it too), with `plugin/plugin.js` rebuilt and committed.
- [ ] `ORCA_LIVE=1` live test run, if the change touches how the plugin talks to Orca
      (add `ORCA_HOST=<server>` if it touches remote servers).
- [ ] **Tried in Buzz itself:** installed from `plugin/`, mentioned an Orca agent, replied to it, and
      checked its reply and its Activity tab. On a remote server too, if the change touches one.
- [ ] `AGENTS.md` updated if a hard rule changed.
- [ ] For a release: `version` in `package.json` and `package-lock.json`, and a `CHANGELOG.md`
      section.

## Tried in Buzz

<!-- Which agent, which conversation, and what you saw. "Not yet" blocks a release. -->
