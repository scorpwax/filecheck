# Changelog

All notable changes to FileCheck are recorded here.

The format follows [Keep a Changelog](https://keepachangelog.com/), and FileCheck
uses [Semantic Versioning](https://semver.org/): **MAJOR.MINOR.PATCH**
- **MAJOR** — big or breaking changes
- **MINOR** — new features, backwards-compatible
- **PATCH** — bug fixes and small tweaks

## [Unreleased]

_Work in progress lands here, then moves under a version heading on release._

## [1.0.0] — 2026-10-27

First release.

### Added
- **Video ↔ AAF check** — drop a Video folder and an AAF folder; see counts, what matches, and what is missing on either side. Separated Files (AAF folders) and Embedded Files (loose `.aaf`) modes.
- **Name cleaning and sequencing** — strips junk words, versions, dates and special characters, and numbers matched pairs `##_Name`. Editable word list with saved presets.
- **Rename** — save renamed copies into a `Renamed` folder (optional prefix/suffix) or rename in place, with undo. In Separated mode the `.aaf` inside each folder is renamed to match.
- **Possible matches** — close names or the same number, confirmed with checkboxes.
- **Duplicates and repeated numbers** — copies are flagged; delete selected items to the Trash.
- **Empty `AAF Media` check**, plus video and AAF length badges with a length-difference flag.
- **Copy message** for the sender, CSV report, and auto re-check when the folders change.
- Version number in the header and an update banner when a newer release is published on GitHub.
