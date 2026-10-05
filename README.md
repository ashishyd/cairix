# Cairix

**Run it, fix it, learn it.** A project-centric developer cockpit for macOS, by Kitium AI.

Add the folders you work in. Cairix finds every project inside them (monorepo apps included), gives each script a one-click Run button, shows every dev server listening on your machine with its memory and a safe Stop button, and lists the Claude Code and Cursor agents running locally. Review pending changes, dispatch agent tasks, and run on-demand audits from one Review workspace — with one-click fixes, undo, and “learn why” links.

## What you get

- **Projects** — add folders; discover nested apps (monorepos, Node, Python, Compose, Make, Cargo, Go). Folders start untrusted until you opt in.
- **Scripts** — one-click Run for `package.json`, `pyproject.toml`, Django `manage.py`, `Makefile`, Compose, and `.py` entry points.
- **Ports** — every localhost listener, memory footprint, project link, protected system services, and a safe kill.
- **Processes** — background dev tooling, databases and your other processes, one row per process tree with memory, CPU, uptime and the ports it owns, and a guarded Stop (graceful first, force only if you confirm).
- **Commands** — every command you run in any terminal, counted from your shell history: how many times, a plain-English description, one-click re-run (in your home folder or a trusted project), a filter box, sorting (most run first by default) and a “never track” list for a single command or a whole program.
- **Runs** — every finished script run, kept across restarts: result, exit code, duration, the end of its output (secrets masked), filters, one-click re-run, and a per-script view with success rate, average time and a “flaky” flag.
- **Notifications** — a macOS notification when a script fails (or a run of 15 s or more finishes), and when an agent task or audit completes. Clicking it opens the right page. Each category, and “only when Cairix is in the background”, is a setting, with a “send a test” button.
- **Agents** — live Claude Code sessions and Cursor workers/plans (read-only).
- **Review** — one project tab for Overview, Changes, Tasks, and Audit:
  - **Changes** — instant checks (secrets, debug leftovers, conflict markers, risky patterns), optional Claude AI review, fix with diff preview and undo, learn links
  - **Tasks** — ask Claude or Cursor in plain words; read-only, or edits in a throwaway worktree you apply and undo
  - **Audit** — pick categories, see files/requests/cost ceiling first, parallel AI run with cancel, compare with last audit, Markdown report
- **Getting Started** — Home checklist that walks Trust → Run → Changes → Tasks (dismissible, persisted).
- **Home dashboard** — Overview, Running, Listening, Agents, Pending changes, Pinned scripts. Reorder, resize, add/remove, reset.
- **Actions** — your own shell commands, links, and “open in app” shortcuts on projects, ports, and findings.
- **Plugins** — sandboxed plugins for widgets, project tabs, and ⌘K commands; see `docs/PLUGINS.md`.
- **Command palette (⌘K)** — jump to projects, Review sections, scripts, ports, plugins, and custom actions.
- **Keyboard shortcuts** — rebindable (⌘/ opens the editor); Review defaults include ⌘⇧1–5 for Scripts/Review sections, ⌘⇧R for AI review, ⌘⇧N for a new task.
- **Appearance** — themes, accent colours, density, text size (typed type/spacing scale), menu-bar count, global shortcut.

## Run it

```bash
pnpm install        # also makes sure the Electron binary is present
pnpm dev            # electron-vite dev server with hot reload
```

| Command | What it does |
|---|---|
| `pnpm build` | Production build into `out/` |
| `pnpm typecheck` | Type-check main and renderer |
| `pnpm test` | Unit tests (vitest) |
| `CAIRIX_LIVE=1 pnpm test` | Also runs smoke tests against the real OS: starts a real server, finds it, kills it, checks the port is freed |
| `pnpm e2e` | Launches the **built** app and drives the real UI end to end (needs `pnpm build` first). Uses throwaway data. |
| `CAIRIX_E2E_APP=…/Cairix.app/Contents/MacOS/Cairix pnpm e2e` | The same scenario against a packaged build |
| `node tests/e2e/native-shot.mjs` | Screenshots the real window (vibrancy, traffic lights). Needs Screen Recording permission |
| `pnpm icons` | Regenerates every icon from `build/*.svg` |
| `pnpm dist:mac` | Builds the app and DMG/zip, then installs to `/Applications` |

`CAIRIX_USER_DATA=/some/dir` points Cairix at throwaway settings/projects instead of your real ones. `CAIRIX_HOME=/some/dir` makes the Agents view read a fake home folder.

## How it's built

```
src/main/          everything that touches the machine: discovery, scripts, ports, agents, IPC
  modules/<id>/    one folder per feature (service + handlers); wired together in modules/index.ts
src/preload/       the typed bridge exposed as window.cairix (sandboxed: imports only electron)
src/shared/        contracts both sides agree on: IPC channels, types, settings schema, CSP, redaction
src/renderer/src/  React UI: stores (Zustand), views, one folder per module
resources/ build/  icons (SVG sources → icns/png via scripts/make-icons.mjs)
tests/             unit tests, opt-in live OS tests, end-to-end driver
```

Every feature is a **module**: a manifest entry in `src/shared/modules.ts`, a service + IPC handlers in `src/main/modules/<id>`, and a component in `src/renderer/src/modules/<id>` registered in `modules/registry.tsx`. Modules can add a tab to every project and/or a page under “Machine”. Nested Changes/Tasks/Audit fold into the Review tab when Review is enabled. New features plug in there and nowhere else.

## Safety decisions worth knowing

- **Folders start untrusted.** Cairix will list a folder’s scripts but won’t run them until you tick “Trust this folder”: a cloned repo’s `package.json` can run anything.
- **The UI never sends a command.** It sends a script *id*; main rebuilds the command from files on disk. File paths must come from the native folder picker or an already-added folder.
- **Killing is guarded.** Targets are re-derived from a fresh scan, never from the UI. macOS services (`ControlCenter` squatting on :5000/:7000, `rapportd`), other users’ processes, Docker plumbing and Cairix itself are protected. SIGTERM first, force quit only if you confirm.
- **Secrets stay out of the UI.** Command lines are redacted before they leave the main process (`--api-key …`, `TOKEN=…`, `user:pass@host`, known token shapes). Agent views carry no command line at all, because Cursor’s workers receive `--api-key` on argv.
- **Claude’s session registry is read narrowly.** Only `~/.claude/sessions/<pid>.json`, only whitelisted fields. The neighbouring `*.key` files (per-session tokens) and the messaging socket path are never read.
- **Scripts get your real terminal environment** (login-shell `PATH`, `NVM_DIR`, …) minus Cairix’s own variables (`ELECTRON_RENDERER_URL`, `npm_*`, `NODE_ENV`) so another Electron app started from Cairix doesn’t load Cairix’s page.
- **Command history stays on your Mac and skips secrets.** Cairix reads `~/.zsh_history` (also bash and fish) and only counts new lines. Any command containing a token, password or key is dropped, never stored. “Never track” also forgets what was already counted, and the module can be switched off under Settings → Modules, after which nothing is read. Re-running sends only an id: main looks the command up itself, asks before anything that deletes, forces or runs as administrator, and opens editors and REPLs in Terminal.app.
- **Stopping a process is re-derived in main.** The UI sends a pid and the view it was looking at; main rescans, accepts only a listed tree root, and refuses shells, macOS services, installed apps, other users' processes and Cairix itself.
- Renderer is sandboxed with a strict CSP; IPC arguments are validated with zod; links open only `https://` or `http://localhost`.

## Notes and known limits

- **macOS only for now.** Port scanning uses `lsof` and `ps`; the scanner sits behind an interface so Linux/Windows can be added.
- `lsof` only sees *your* processes unless run as root, which is the right scope for this app.
- **Signing:** `electron-builder` auto-discovers a code-signing identity in your keychain and signs with it. That’s fine for running on your own Mac. For distribution you need a Developer ID certificate and notarization; set `CSC_IDENTITY_AUTO_DISCOVERY=false` to build unsigned.
- If `pnpm dev` says Electron isn’t installed, run `node scripts/ensure-electron.mjs` (pnpm sometimes skips Electron’s own download step; `postinstall` already does this).
- **Changes / AI:** instant checks are free. AI review and AI fix call your local `claude` CLI — if it isn’t signed in, Cairix says so and keeps the instant checks. Run `claude auth login`. AI review is manual by default; Settings → Code review turns on automatic review (uses your quota). The AI sees only changed lines, with `.env` files dropped and credentials masked, and the prompt goes over stdin, not the command line.
- **Audit cost:** an audit shows its plan first. Each request is capped at $0.15 by the CLI itself, so the printed ceiling is a real upper bound. It analyses at most ~400 KB of source per run (application code first); larger projects say so.
- `CAIRIX_CLAUDE_BIN=/path/to/fake` swaps the Claude executable; the end-to-end test uses it so tests never spend money.
- **Custom actions never paste values into commands.** `{file}`, `{branch}` and friends travel as environment variables and are referenced quoted, so a file named `a; rm -rf ~` is just text. Main resolves ids to paths itself; the UI only sends ids and small numbers.
- **Plugins are untrusted code.** Each runs in its own Chromium-sandboxed hidden window (no Node, files, network, popups or external scripts) and reaches Cairix only through a permission-checked broker; its UI is a validated declarative tree, never HTML. Known limit: a plugin can burn CPU inside its own sandbox until it stops responding (then it is switched off).
- **Agent tasks never edit your files directly.** Read-only tasks get only Read/Grep/Glob. Edit tasks run in a throwaway git worktree (your uncommitted work included) with Edit/Write but no shell or web, and you apply the resulting diff yourself. Claude’s prompt goes over stdin; Cursor’s agent only accepts it as an argument, so it is visible in the process list.
- Cursor exposes less than Claude Code: there is no session registry, so Cursor agents show as “Running” workers with their folder, not busy/idle.

## Build & install to /Applications

```bash
pnpm deploy:mac     # build + package + install /Applications/Cairix.app, then open it
pnpm install:mac    # install the last build only (flags: --dest <dir>, --dry-run, --no-quit, --open)
```

A running Cairix is quit first. Live tests against your logged-in Claude CLI (a few cents):
`CAIRIX_LIVE=1 pnpm vitest run tests/live/claude.live.test.ts`
