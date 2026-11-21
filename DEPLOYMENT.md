# Goliath Deployment

## Canonical deployment model

GitHub `dev` is the central source of truth for tracked application code.

DEV uses a safe two-way Git workflow on the workstation and an automatic one-way deployment from GitHub to VPS DEV:

```text
LOCAL DEV
  <-> origin/dev
        -> Sync Goliath (automatic)
             -> VPS DEV
```

BETA and PRODUCTION do **not** automatically follow DEV.

Run **Deploy Goliath** manually and select either `beta` or `production`. Choose `current-branch` (default) to deploy the existing target branch without promotion, or `promote-dev` for a deliberate full promotion.

```text
origin/dev
   -> Deploy Goliath -> origin/beta       -> VPS BETA
   -> Deploy Goliath -> origin/production -> VPS PRODUCTION
```

Direct VPS DEV source edits are not canonical. Sync Goliath refuses to overwrite dirty tracked files outside `src/runtime`, so source changes should be committed on local DEV and pushed to `origin/dev` instead.

Runtime data is intentionally NOT synchronised between environments.

```text
/home/goliath/dev/src/runtime/dev
/home/goliath/beta/src/runtime/beta
/home/goliath/production/src/runtime/production
```

This includes guild JSONs, SQLite databases, logs, backups, cache and other deployment-local state.

## VPS checkouts

```text
/home/goliath/dev
/home/goliath/beta
/home/goliath/production
```

## PM2 processes

```text
goliath-dev
goliath-beta
goliath-production
```

Sync Goliath and Deploy Goliath reload the correct PM2 process after a checkout is updated and verify the final Git commit and working directory.

## Sync local DEV before working

Run this from the local Windows `dev` branch with a clean working tree:

```bash
npm run sync:dev
```

The command safely synchronises local DEV and GitHub DEV in either fast-forward direction:

- if GitHub DEV is ahead, local DEV fast-forwards to it;
- if local DEV is ahead, the command pushes DEV through the normal pre-push validation hook;
- if both sides diverged, it stops rather than overwriting either side.

It does not change BETA or PRODUCTION.

## Automatic local DEV watcher

The optional workstation watcher can keep a clean local DEV checkout aligned with `origin/dev`:

```bash
npm run sync:dev:install
```

That installs the Windows logon task. The watcher checks every 30 seconds by default, fast-forwards when GitHub is ahead, pushes when local DEV is ahead, and refuses diverged or dirty states.

The interval can be overridden with `GOLIATH_DEV_SYNC_INTERVAL_MS`. Values below 10 seconds are clamped to 10 seconds and invalid values fall back to 30 seconds.

## Normal DEV workflow

Work on `dev`.

Before starting or before pushing, synchronise DEV:

```bash
npm run sync:dev
```

Then work normally:

```bash
git add .
git commit -m "describe the change"
npm run sync:dev
```

A normal `git push origin dev` remains supported. The tracked pre-push hook runs validation only; it does not move BETA or PRODUCTION refs.

Every successful push to `origin/dev` automatically triggers **Sync Goliath**, which aligns `/home/goliath/dev` to that exact DEV commit while preserving `src/runtime/dev`, rebuilds the dashboard, synchronises commands, restarts `goliath-dev`, and verifies the final SHA.

`package.json` configures `.githooks` through the npm `prepare` script.

If hooks are not active on a fresh clone, run once:

```bash
npm install
git config core.hooksPath .githooks
```

## Manual BETA or PRODUCTION promotion

Use **Actions -> Deploy Goliath -> Run workflow** and select exactly one target:

```text
beta
production
```

With `current-branch`, the workflow validates the selected branch, checks that its SHA has not changed, and deploys that exact commit without writing to the target Git ref. Select the updated workflow definition from `dev` when dispatching.

With `promote-dev`, Deploy Goliath deliberately:

1. checks out and validates current `origin/dev`;
2. creates a promotion commit on the selected target branch using the DEV application tree;
3. deploys that promoted commit to the matching VPS checkout;
4. preserves that environment's runtime directory;
5. runs doctor/build/command sync;
6. reloads the matching PM2 process;
7. verifies the selected GitHub branch, VPS checkout and PM2 working directory match.

BETA and PRODUCTION are independent manual promotions. Deploying BETA does not automatically deploy PRODUCTION, and deploying PRODUCTION does not require promoting from BETA.

## What each successful operation proves

A successful `npm run sync:dev` proves local DEV and `origin/dev` match at that moment.

A successful **Sync Goliath** run proves the triggering GitHub DEV commit was deployed and verified on VPS DEV.

A successful **Deploy Goliath -> beta** run proves the validated DEV application tree was promoted to `origin/beta` and deployed to VPS BETA.

A successful **Deploy Goliath -> production** run proves the validated DEV application tree was promoted to `origin/production` and deployed to VPS PRODUCTION.

The environments can and should still have different runtime data, Discord guilds, tokens, `.env` files and moderation databases.

## Manual promotion commands

These remain available for recovery or deliberate local operation:

```bash
npm run promote:beta
npm run promote:production
```

The normal full promotion path is **Deploy Goliath** because it handles the GitHub target branch, VPS deployment, dashboard, commands and PM2 verification together.

## Important

Never copy one environment's runtime directory into another to make source code appear synchronised. Runtime data is deployment-local by design.
