# Releasing Vcode

A release is a Windows installer on GitHub Releases. Installed copies check those releases
about 30 seconds after start-up and every 6 hours. They download a new version in the
background and install it the next time the app quits, or straight away from the tray's
"Restart to update".

## Steps

1. Set the new version in `apps/desktop/package.json` (`"version": "0.2.0"`). Commit and push
   to `main`, and wait for CI to pass.
2. Tag that commit and push the tag:

   ```sh
   git tag v0.2.0
   git push origin v0.2.0
   ```

3. The **Release** workflow (`.github/workflows/release.yml`) checks that the tag matches the
   version, runs every check and the end-to-end tests, builds the installer, and uploads it to a
   **draft** release named after the version. The upload includes `Vcode-Setup-0.2.0.exe`, its
   `.blockmap` (for smaller updates) and `latest.yml` (what installed copies read).
4. Open the draft on GitHub, write the release notes, and try the installer.
5. **Publish** the release. Installed copies only see published releases, so this is the
   moment users start getting the update.

To build an installer locally without publishing, run `pnpm dist`. It goes to
`apps/desktop/release/`.

## Things to know

- **Unsigned for now.** Until the code-signing certificate is decided (ROADMAP P8-03),
  Windows SmartScreen warns "Windows protected your PC" on the first run. Users get past it
  with *More info → Run anyway*.
- **Don't delete or edit a published release's files.** Installed copies verify downloads
  against `latest.yml`. If something is wrong, publish a new version instead.
- **Versions only go up.** electron-updater installs only newer versions.
