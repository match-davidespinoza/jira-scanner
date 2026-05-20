# Jira Scanner

A local Electron desktop app for scanning your Jira issues. No cloud services — queries the Jira REST API directly using your API token stored locally.

## Setup

```bash
npm install
npm start
```

On first launch, fill in the setup banner:
- **Jira Base URL** — e.g. `https://yourcompany.atlassian.net`
- **Account Email** — your Atlassian account email
- **API Token** — generate one at https://id.atlassian.com/manage-profile/security/api-tokens

## Reports

| Report | Description |
|---|---|
| Recent Comments | Comments posted on your issues within the time window |
| Open Tickets | All open issues assigned to you |
| High Priority | High/Highest priority open issues |
| Recently Updated | Issues updated within the time window |
| Overdue Issues | Issues past their due date |
| Blocked Issues | Issues labeled or statused as Blocked |

## Build

```bash
npm run build:mac    # macOS dmg
npm run build:win    # Windows installer
npm run build:linux  # Linux AppImage
```
