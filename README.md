# FileCheck

A small Mac app for checking a batch of video files against their AAFs before a mix.
Drop the Video folder and the AAF folder, and FileCheck shows what matches, what is missing,
and what the renamed files will look like — then renames them so each video and AAF share the same
`##_Name`.

## Run it

```bash
npm install
npm start
```

## Build

```bash
npm run dist       # quick unsigned .app in dist/mac (for testing)
npm run dist:mac   # signed DMG (needs the Developer ID certificate in your keychain)
```

## Releasing

1. Add the changes to `CHANGELOG.md` and bump the version (`npm run version:patch`, `version:minor` or `version:major`).
2. Commit as `vX.Y.Z — short summary`, push to `main`, then tag and push the tag:

   ```bash
   git tag vX.Y.Z && git push --tags
   ```

3. GitHub Actions builds, signs and notarizes the DMG and publishes a GitHub Release. Running copies of
   FileCheck check the latest release and show an update banner with a Download button.

CI needs these repository secrets: `CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_API_KEY_CONTENT`,
`APPLE_API_KEY_ID`, `APPLE_API_ISSUER`.

See `roadmap.md` for what's planned.
