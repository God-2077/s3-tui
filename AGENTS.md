# AGENTS.md

## Commands

- Node >= 20.12 and pnpm (lockfile is `pnpm-lock.yaml`; don't use npm/yarn).
- `pnpm typecheck` — `tsc --noEmit`. `tsconfig.json` includes only `src/**`; test files are never typechecked.
- `pnpm test` — `node:test` run through the tsx loader. The file list is hard-coded in `package.json`; add new test files there or they silently won't run.
  - Single file: `node --import tsx --test test/key.test.ts`
  - Single test: append `--test-name-pattern="<test name>"`
- `pnpm build` — tsc to `dist/`; `bin` points at `dist/cli.js`. `pnpm start` and a globally linked `s3-tui` run the built output, so build before trying them. `pnpm dev` runs `src/` directly.
- `pnpm dev` renders an Ink TUI and requires a real TTY, so it fails when spawned non-interactively. For a smoke check use `pnpm exec tsx src/cli.tsx --help`.
- No lint or formatter script is configured; don't invent one.

## Architecture

- Single-package ESM with NodeNext resolution: every relative import needs a `.js` suffix even from `.ts`/`.tsx` (e.g. `import { App } from "./components/App.js"`).
- Entry `src/cli.tsx`: arg/TTY checks, `.env` load, config validation, then render. UI state and key handling all live in `src/components/App.tsx` (single large component); S3 work is isolated in `src/s3/`; the transfer queue is `src/hooks/useTransfers.ts` (files run one at a time, parts concurrent within a file).
- `S3Context.main` vs `S3Context.transfer` (`src/s3/client.ts`): list/delete/metadata always use `main`; upload/download/presign use `transfer`. Accelerate modes `endpoint` / `rewrite` / `public` decide how the accelerate host is applied; `public` keeps `transfer === main` and only builds unsigned links.
- Keep `requestChecksumCalculation` / `responseChecksumValidation: "WHEN_REQUIRED"` on the AWS SDK clients; removing them breaks MinIO/R2 compatibility.
- Multipart invariants (`src/utils/parts.ts`): parts >= 5 MiB and <= 10,000 parts; failed or cancelled multipart uploads abort via `AbortMultipartUpload`.
- Terminal layout must use the display-width helpers in `src/utils/format.ts` / `input.ts` (CJK and emoji occupy 2 columns), not `String.length`.
- tsconfig is strict with `noUncheckedIndexedAccess`, so indexed access yields `T | undefined`.

## Config and docs

- Config comes only from env vars (`S3_*`, with some `AWS_*` fallbacks), parsed in `src/config.ts`. `.env` is loaded via Node's `process.loadEnvFile`, and existing env vars win. New vars need a `CONFIG_FIELDS` entry (drives `--help` and validation errors), a README table row, and a `.env.example` line.
- User-facing text, README, CLI help, error messages, and test names are Chinese; keep new ones Chinese.
- `.env` holds real credentials and is gitignored — never read, print, or commit it.
- `dist/`, `downloads/`, `temp/`, and `*.log` are generated/ignored; edit `src/` only, not `dist/`.

## Tests

- `node:test` + `node:assert/strict`. `test/mockS3.ts` is a minimal local S3 HTTP server (list/put/get/multipart/batch delete) on an ephemeral port — no external S3 needed. `startMockS3({ bucketless: true })` simulates a bucket-bound accelerate host.
- Integration and accelerate tests use multi-MiB temp files and tmpdirs; clean up in `finally` (`client.destroy()`, `server.close()`, `rm(dir)`).
- Use `parseConfig({ ... })` with explicit env objects in tests; never depend on the developer's `.env`.

## Conventions

- `pnpm-workspace.yaml` is not a monorepo; it only configures pnpm `allowBuilds` for esbuild.

## Git Commit Guidelines

- Only create commits when explicitly requested by the user; do not modify or rebase pushed history.
- Each commit should contain only one logical change and must not mix in unrelated formatting, refactoring, or dependency upgrades.
- Commit messages must follow Conventional Commits:

  `<type>(<scope>): <description>`

  - `type` is required and lowercase: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `chore`, `ci`
  - `scope` is optional, lowercase, and indicates the area of impact, e.g. `auth`, `parser`, `api`
  - `description` uses the English imperative mood, starts lowercase, has no period, and should preferably not exceed 50 characters
- Leave a blank line between the description and the body; focus on explaining "why the change was made" and necessary context, and do not repeat "what was changed."
- Use footers to link related issues, e.g. `Closes #123`.
- Breaking changes must add `!` after the type/scope, or include `BREAKING CHANGE: <description>` in a footer.
- Do not use vague commit messages such as `update`, `fix bug`, or `changes`.
- If commitlint / Husky validation fails, fix the commit message; do not bypass it with `--no-verify`.

Examples:

```text
feat(auth): add JWT-based login

Replace session-based login to support distributed deployments.

Closes #123
```

```text
refactor(api)!: remove deprecated endpoint

BREAKING CHANGE: `/v1/users` has been removed; use `/v2/users`.
```