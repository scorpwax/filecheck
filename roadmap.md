# FileCheck roadmap

Things we want to add later, roughly in priority order.

## Planned

- **Open in Finder buttons.** A button on any row (matched, missing, duplicate, possible match) that reveals the file or folder in Finder, so a suspect file is one click away.
- **History.** A short list of recent checks (date, folders, counts), with the report each one produced, so you can look back at what a batch looked like when it arrived.

## Ideas / known gaps

- **Check AAF lengths on real exports.** The AAF length reader (longest timeline in the composition) is tested on generated AAF files. Real Avid / Pro Tools exports may need tweaks, such as which track counts as the main timeline.
- **More video formats.** Video lengths are read from MP4/MOV headers. MXF and other wrappers show no length yet.
- **Per-project settings.** Remember the last folders and the word-list preset for each project.

## Done

- Separated / Embedded AAF modes
- Name cleaning, sequencing, copy-or-rename, undo
- Possible matches (close names, or the same number) with checkboxes
- Duplicate and repeated-number detection, with delete to Trash
- Word-list presets
- Copy-a-message-to-send-back button
- Auto re-check when the folders change
- Empty `AAF Media` folder check
- Video and AAF length badges, with a length-difference flag
- Number-only names match automatically; link files by hand
- Ignore checked matches (left out of the rename)
