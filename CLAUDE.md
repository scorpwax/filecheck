# FileCheck — Claude Code Guide

FileCheck is an Electron app (plain JS, no bundler) that compares video files with AAFs, cleans and
sequences their names, and renames them. Mac only.

## Structure

```
src/
  main.js       Electron main process: IPC for scanning, rename/copy, undo, delete-to-Trash, folder watching, updates
  preload.js    contextBridge API exposed to the renderer as window.api
  core.js       Pure logic (runs in Node and the renderer): name cleaning, matching, duplicates, sequencing
  media.js      Video length from MP4/MOV headers; empty "AAF Media" check
  aaf.js        Reads an .aaf's timeline length straight from the compound file (no AAF SDK)
  updater.js    Checks GitHub Releases (scorpwax/filecheck) for a newer version
  renderer.js, index.html, styles.css   The UI
build/          Icon (icon-source.webp → icon.icns via `npm run icon`), entitlements
test/           node:test tests for core.js (`npm test`)
```

## Rules

- **Versioning:** bump `version` in `package.json` and add a `CHANGELOG.md` entry on every change (semver: patch for fixes, minor for features).
- Commit messages: `vX.Y.Z — short summary`.
- When a change ships something tracked in `roadmap.md`, mark it done instead of deleting it.
- Video = blue and AAF = teal everywhere in the UI (see the `--video` / `--aaf` CSS variables).
- Anything that deletes goes to the Trash (`shell.trashItem`), never a permanent delete, and asks first.

## Commands

```bash
npm start          # run in development
npm test           # core.js tests
npm run dist       # unsigned .app for a quick test
npm run dist:mac   # signed DMG
npm run icon       # rebuild build/icon.icns from build/icon-source.webp
```
