# Release notes — v2.4.0

## Added
- Offline mode for the notes editor. Edits are queued and synced when the connection returns.
- CSV export for monthly reports, with a header row and UTF-8 BOM option for Excel.

## Changed
- Search results now show the section path above each snippet.
- Session timeout moved from 15 to 30 minutes of inactivity.

## Fixed
- Dark theme contrast on code blocks.
- Crash when a file name contained a trailing space on Windows.

## Known issues
- Large PDF imports (over 200 pages) can take more than a minute to index.
