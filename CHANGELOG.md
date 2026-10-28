# Changelog

All notable changes to FileCheck are recorded here.

The format follows [Keep a Changelog](https://keepachangelog.com/), and FileCheck
uses [Semantic Versioning](https://semver.org/): **MAJOR.MINOR.PATCH**
- **MAJOR** — big or breaking changes
- **MINOR** — new features, backwards-compatible
- **PATCH** — bug fixes and small tweaks

## [Unreleased]

## [1.3.0]

### Added
- Matched list has checkboxes and an **Ignore Checked** button. Ignored pairs are left out of the rename (and out of re-sequence numbering) and move to an "Ignored" list, where **Restore Checked** brings them back. They show as "Ignored" in the exported report.

## [1.2.0]

### Changed
- Title Case for the folder, options and stat labels; stylesheet tidied.

### Added
- Files named only by a number (an AAF folder called `04`) now match the video with that number (`04_What to Expect`) as a real match. Repeated numbers are still left for you to sort out.
- Link by hand: every file under "Video with no AAF" / "AAF with no video" has a "Link to…" dropdown. Picking a file moves the pair into Matched, where an Unlink button undoes it.

_Work in progress lands here, then moves under a version heading on release._

## [1.1.0] — 2026-10-28

### Added
- **Start number for re-sequencing** — under Numbering, "Start at" sets the first number (default 01). Start at 04 and the pairs become 04, 05, 06… The field is only used with "Re-sequence" and is greyed out for "Keep existing numbers".

- **Row highlight** — rows in the Matched list highlight when you hover over them.

### Fixed
- The "Start at" and length-threshold boxes were far wider than intended because the app's security policy blocks inline styles; their size now comes from the stylesheet.

## [1.0.1] — 2026-10-27

### Changed
- First published release (v1.0.0 was tagged on GitHub but never built as a release). No app changes.

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
