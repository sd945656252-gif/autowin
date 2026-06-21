# JIYING Scripts

This folder is grouped by operational purpose:

- Development checks: `dev-check.ps1`, `browser-console-check.mjs`
- Local cleanup: `clean-dev-artifacts.ps1`
- API provider setup: `api-provider-wizard.mjs`
- Podman/local networking: `launch-jiying.ps1`, `start-podman-dev.ps1`, `invoke-podman-compose.ps1`, `podman-*-forwarder.mjs`, `share-lan.ps1`
- Database backup/restore: `backup-postgres.ps1`, `restore-postgres.ps1`, `weekly-backup-postgres.ps1`, `install-backup-task.ps1`
- Account checks: `account-settings-smoke.mjs`, `avatar-replacement-smoke.mjs`, `role-access-smoke.mjs`, `sync-primary-admins.mjs`
- Security/repository checks: `check-repo-safety.mjs`, `security-smoke.mjs`
- Workflow smoke tests: `*-smoke.mjs`

Primary local startup is now the root launcher `Start JIYING.cmd`, which calls `launch-jiying.ps1` and then `start-podman-dev.ps1`.

Prefer package scripts in `package.json` when one exists. Use direct script execution only for lower-level maintenance tasks.
