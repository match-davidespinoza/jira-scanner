# Changelog

## [1.0.0] - 2026-05-20

### Added
- Initial release of Jira Scanner, a local Electron desktop app for monitoring Jira issues
- Six built-in reports: Recent Comments, Open Tickets, High Priority, Recently Updated, Overdue Issues, and Blocked Issues
- Jira REST API integration using Basic Auth (email + API token) stored locally — no cloud services
- Okta SSO login flow via a sandboxed browser window; session cookies are persisted and used automatically for subsequent API calls
- System tray icon with a popup window showing recent comments at a glance
- Desktop notifications via the system notification API
- Launch at login toggle in settings
- macOS hidden-inset title bar for a native look
- Cross-platform build support: macOS (DMG), Windows (NSIS installer), Linux (AppImage)
- Separate tray icon from app/dock icon, with automatic light/dark mode switching
- Mark as seen on individual comments — clicking the indicator fades the comment and persists state across sessions
- Seen state syncs in real time between the tray popup and the main app window via IPC
