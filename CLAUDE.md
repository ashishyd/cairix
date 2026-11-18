# Cairix

## What this is
Cairix is a macOS desktop app (Electron 44, React 19, TypeScript, Tailwind 3, Zustand, zod) by Kitium AI: a developer cockpit that lists the user's projects, runs their scripts, shows and kills local ports and processes, drives git and Docker, and calls the user's own `claude` CLI for reviews, tasks, audits and lessons. There is no server and no database. State is JSON files in Electron's `userData` folder. It runs on the developer's real machine, so "production data" here means: the user's real projects, real processes, `~/.zshrc`, shell history, `.env` files and paid Claude usage.

Three processes, one direction of trust:
- `src/main` (Node) does everything that touches the machine.
- `src/preload` exposes a typed bridge, `window.cairix`, to the page.
- `src/renderer` (sandboxed React page) only draws and calls `window.cairix`. It is treated as untrusted: it sends ids, never commands or paths.

## Folder map
- `src/shared/` — contracts both sides import: `ipc.ts` (channel names), `api.ts` (`CairixAPI` type), `types.ts`, `modules.ts` (module list), `settings.ts` (zod schema, main only), `settings-types.ts` (types and defaults, renderer), `design.ts`, `redact.ts`, `csp.ts`. No Node or Electron imports here.
- `src/main/index.ts` — app start-up. `src/main/modules/index.ts` — the one place every service and handler is built and wired.
- `src/main/modules/<id>/` — one feature: `service.ts` (logic), `handlers.ts` (IPC), plus parsers and stores.
- `src/main/ipc.ts` (`handle`), `json-store.ts`, `security.ts`, `shell-env.ts`, `broadcast.ts`, `settings.ts` — shared main helpers. Use them.
- `src/preload/index.ts` — app bridge. `src/preload/plugin.ts` — bridge for sandboxed plugin windows.
- `src/renderer/src/modules/<id>/` — one feature's UI. `modules/registry.tsx` maps a module id to its components.
- `src/renderer/src/components/ui.tsx` — UI primitives. `stores/` — Zustand stores. `lib/util.ts`, `lib/hooks.ts` — helpers. `styles/globals.css` — design tokens.
- `tests/*.test.ts` — unit tests, flat. `tests/live/` — opt-in tests against the real OS. `tests/e2e/smoke.mjs` — drives the built app with fake `claude`, `docker`, `gh`.
- `docs/PLUGINS.md`, `examples/plugin-hello/` — plugin API.
- Generated, never edit or commit: `out/`, `dist/`, `node_modules/`, `tests/e2e/shots/`, `.cairix-dev/`.

## Commands
Package manager is pnpm. There is no linter, no formatter and no CI: `typecheck` and `test` are the only gates.

```bash
pnpm install          # also downloads the Electron binary (postinstall)
pnpm typecheck        # tsc for main+preload+shared+tests, then for renderer
pnpm test             # vitest, node environment, about 15 s, safe
pnpm vitest run tests/containers.test.ts   # one file
pnpm build            # production build into out/
pnpm e2e              # launches the BUILT app with throwaway data; run pnpm build first
pnpm dev              # DANGER: opens the app on the user's real data, see below
pnpm start            # DANGER: same, from the last build
pnpm icons            # rewrites committed icon files in build/ and resources/
pnpm dist:mac         # DANGER: packages a DMG/zip into dist/ and signs with a keychain identity
pnpm install:mac      # DANGER: quits Cairix, deletes and replaces /Applications/Cairix.app
pnpm deploy:mac       # DANGER: dist:mac + install:mac + opens the app
```

## Things that touch real data
| Action | What it really does |
|---|---|
| `pnpm dev`, `pnpm start` | Uses the real `userData` folder: real project list, real schedules (the scheduler starts and can run the user's scripts and agent tasks), reads real shell history. Set `CAIRIX_USER_DATA=<temp dir>` and `CAIRIX_HOME=<temp dir>` first. |
| `CAIRIX_LIVE=1 pnpm test` | Starts and kills real processes. `tests/live/claude.live.test.ts` spends real money on the logged-in Claude CLI. |
| `pnpm install:mac`, `pnpm deploy:mac` | Quits the running app and replaces `/Applications/Cairix.app`. |
| `node tests/e2e/native-shot.mjs` | Screenshots the real screen; needs Screen Recording permission. |
| Any code path that runs `claude` without `CAIRIX_CLAUDE_BIN` set to a fake | Paid usage. Tests use `tests/e2e/fake-claude.mjs` or `tests/fixtures/fake-agent.mjs`. |

## Working rules
- Before non-trivial work, say in two or three lines what you will change and how you will prove it. Then start.
- Make the smallest complete change. No refactors, renames, new dependencies or new abstractions that were not asked for.
- Ask before: commit, push, any command marked DANGER above, deleting files, running `claude` for real.
- Never open `.env` files, key files, anything under the real `userData` folder, `~/.claude`, or `~/.zsh_history`.
- If the same fix fails twice, stop and report what you learned.
- When two approaches are both reasonable, give each in one line and say which you would pick. Never choose silently on the trust model, IPC surface, stored-file schema or anything that spends Claude money.
- Report: outcome first, then files changed, commands run with results, what was not verified, what the owner must do next. Write "I did not run X". Never write "should work".

## Coding rules
Style (nothing enforces it, so match it): no semicolons, single quotes, 2 spaces, no trailing commas, explicit return types on functions (`React.JSX.Element` for components), named exports (only `App.tsx` has a default export), no `any`. Comments say why, in one or two lines.

**Adding or changing an IPC call touches five files, always all five:**
1. `src/shared/ipc.ts` — channel constant, named `<module>:<verb>`.
2. `src/shared/api.ts` — method on `CairixAPI`.
3. `src/preload/index.ts` — `call(IPC.x)` or `on(IPC.x, cb)`.
4. `src/main/modules/<id>/handlers.ts` — `handle(IPC.x, z.tuple([...]), fn)` from `src/main/ipc.ts`. Every string gets a `.max()`.
5. `src/main/modules/index.ts` — only when the handler file or service is new.

Copy `src/main/modules/containers/` (service + handlers) and `tests/containers.test.ts`.

**Adding a module:** entry in `src/shared/modules.ts`, folder in `src/main/modules/<id>/`, wire it in `src/main/modules/index.ts` (and add background work to `dispose()`), component in `src/renderer/src/modules/<id>/`, row in `modules/registry.tsx`. Nowhere else.

**Main process**
- Services take their dependencies through a `Deps` interface and do not import `electron`. Only `handlers.ts`, `modules/index.ts`, `projects/store.ts`, `notify/electron.ts` and `plugins/host.ts` import it. This is what lets vitest load services in plain Node.
- The renderer sends an id. Main looks up the path or command itself (`findProject`, `detectScripts`, a fresh `docker ps`, a fresh port scan). Never run a string that came over IPC.
- Anything that runs code or writes inside a project checks `trusted` first and throws a readable error if not.
- Start processes with `execFile`/`spawn` and an argument array. No `exec`, no `shell: true`. Processes started for the user get `await spawnEnv()` from `src/main/shell-env.ts`.
- Stored JSON goes through `readJson(file, zodSchema, fallback)` and `writeJsonAtomic` in `src/main/json-store.ts`.
- Command lines, logs and CLI output pass through `src/shared/redact.ts` before they leave main.
- Paths from outside are checked with `isInside` and URLs with `isSafeExternalUrl` from `src/main/security.ts`.
- Prompts go to `claude` on stdin through `runClaude` in `src/main/modules/changes/ai.ts`, never on argv.
- Errors thrown in main are full sentences a user can read; the renderer shows them as they are.
- Push updates with `broadcast(IPC.xChanged, payload)`.

**Renderer**
- Talk to main only through `window.cairix`. Import with `@/…` and `@shared/…`, not long relative paths.
- Import settings types from `@shared/settings-types`, never `@shared/settings` (that pulls zod into the UI bundle).
- Show failures with `toast.error(errMsg(e))` (`@/stores/toast-store`, `@/lib/util`).
- Join class names with `cx` from `@/lib/util`. Do not add `clsx`.
- Poll only while visible: `!document.hidden && refresh()`.
- Text from Claude, plugins, logs or git is rendered as plain text. No `dangerouslySetInnerHTML`.

**Tests**
- New logic gets a test in `tests/<name>.test.ts`. Vitest only picks up `tests/**/*.test.ts`.
- There are no component tests (node environment). Put logic worth testing in `src/shared/` or a service.
- Fake the outside world through the `Deps` interface, as `tests/containers.test.ts` does. Build temp folders with `makeTree` from `tests/helpers.ts`.

## Design rules
- Use the primitives in `src/renderer/src/components/ui.tsx`: `Button`, `IconButton`, `Chip`, `Kbd`, `StatusDot`, `Toggle`, `Segmented`, `EmptyState`, `PageHeader`, `Skeleton`, `InlineAlert`, `Dialog`. Icons come from `lucide-react`.
- Colours are tokens only: `bg-cx-bg`, `bg-cx-surface`, `bg-cx-raised`, `bg-cx-hover`, `border-cx-border`, `text-cx-text`, `text-cx-muted`, `text-cx-faint`, `text-cx-accent-text`, `bg-cx-accent` with `text-cx-accent-fg`, `cx-success`, `cx-warning`, `cx-danger`. No Tailwind palette classes (`bg-gray-100`), no hex in components (the logo is the one exception).
- Dark mode is automatic: tokens switch on `prefers-color-scheme`, which main drives through `nativeTheme`. Never write a `dark:` class.
- Text sizes come from the scale `text-2xs … text-2xl`. `text-[13px]` fails `tests/design.test.ts`.
- A token lives in three files that must agree: `src/shared/design.ts`, `styles/globals.css`, `tailwind.config.js`.
- Changing any colour token means running `tests/contrast.test.ts`: text must hold 4.5:1 in both themes and for all six accents.
- Page shell: `mx-auto max-w-[1040px] px-page-x py-page-y`. Row padding uses `var(--cx-row-y)` so the density setting works.
- Every view handles four states: loading (`Skeleton` or a short line), empty (`EmptyState` with one sentence on what will appear), unavailable or error (reason plus a retry), and data.
- Every `IconButton` has a `label`. Dialogs use `Dialog` (it handles Escape and ARIA). No `window.confirm` or `alert`.
- The page is `user-select: none` like a native app. Add `selectable` to text a user would copy (logs, paths, commands). Clickable things inside the top bar need `no-drag`.
- Destructive actions use `tone="danger"`, confirm in a `Dialog`, and try the gentle option first (SIGTERM before force).
- Copy is plain, short and concrete: "Docker is installed but not running. Start Docker Desktop." Say what happened and what to do.
- Reference view: `src/renderer/src/modules/containers/ContainersView.tsx`.

## Mistakes a weaker model makes here
| Mistake | Do this instead |
|---|---|
| Adds a channel in preload but not in `ipc.ts`/`api.ts`, or the reverse | Change all five places listed above, then `pnpm typecheck` |
| Calls `ipcMain.handle` directly | `handle()` from `src/main/ipc.ts`; it checks the sender and validates with zod |
| Sends a command, file path or cwd from the renderer | Send an id; main re-derives the rest from disk or a fresh scan |
| Imports `electron` in a `service.ts` | Pass what you need through the `Deps` interface from `modules/index.ts` |
| Imports `zod`, `fs` or a shared helper into `src/preload/index.ts` | Preload is sandboxed: `electron` and `@shared/ipc` constants and types only |
| Adds any import to `src/preload/plugin.ts` | It must import only `electron`; channel names are string literals checked by `tests/plugin-preload.test.ts` |
| Imports `@shared/settings` in the renderer | `@shared/settings-types` |
| Adds a setting to one file | Type and default in `settings-types.ts`, schema in `settings.ts`; nested objects also need the key-by-key merge in `src/main/settings.ts` and `stores/settings-store.ts` |
| Uses `exec` with a built string, or `process.env` for a child | `execFile` with an args array; `spawnEnv()` for the environment |
| Writes JSON with `writeFileSync`, reads with bare `JSON.parse` | `writeJsonAtomic` and `readJson` with a zod schema and a fallback |
| Returns a process command line or log unmasked | `redactTokens` and friends from `@shared/redact` |
| Skips the trust check on a new action that runs or writes in a project | Check `trusted` in the service, as `src/main/modules/git/service.ts` does |
| Guesses the id for shared deps or commands | Module id `shareddeps`, folder `shared-deps`, API `sharedDeps`. The "Commands" page is module `history` |
| Adds Changes, Tasks or Audit style tabs as top-level tabs | Nested tabs set `nestUnder: 'review'` in `registry.tsx`; tab ids go through `canonicalizeProjectTab` in `src/shared/review.ts` |
| Starts a background service and forgets shutdown | Add it to `dispose()` in `modules/index.ts` |
| Runs `pnpm dev` to "check it works" | It opens on real data and real schedules. Use `pnpm test`; for UI use `pnpm build && pnpm e2e` |
| Runs `pnpm e2e` after an edit without building | It runs whatever is in `out/`. Always `pnpm build` first |
| Finds `pnpm dev` exits at once | Another Cairix holds the single-instance lock. Set `CAIRIX_USER_DATA` to a temp folder |
| Trusts the README that `pnpm dist:mac` installs the app | It only packages. `deploy:mac` installs |
| Puts a test next to the source, or writes a React component test | `tests/<name>.test.ts`; move the logic to `src/shared` or a service |
| Uses `os.tmpdir()` paths directly in a test | `makeTree` (macOS `/var` is a symlink; discovery reports real paths) |
| Uses `dark:` classes, palette colours or `text-[Npx]` | Tokens and the type scale |
| Adds ESLint, Prettier, `clsx`, a UI kit or a router | Not here. Navigation is `useUiStore().go(view)` |
| Renders Claude or plugin output as HTML or Markdown-to-HTML | Plain text only; plugin UI is a validated tree, see `docs/PLUGINS.md` |
| Calls the real `claude` in a test | `bin` option or `CAIRIX_CLAUDE_BIN` pointing at a fake |

## Before you say a task is done
- [ ] `pnpm typecheck` exits 0.
- [ ] `pnpm test` exits 0, and new logic has a test in `tests/`.
- [ ] IPC changed: all five places updated; every handler argument has a zod type with a bound.
- [ ] Main changed: no `electron` import in a service, no shell strings, trust checked, output redacted.
- [ ] UI changed: tokens and primitives only, four states handled, icon buttons labelled. Then `pnpm build && pnpm e2e` exits 0, or say that you did not run it.
- [ ] Preload or build config changed: `pnpm build && pnpm test` (the build-output check in `tests/plugin-preload.test.ts` is skipped when `out/` is missing).
- [ ] `git status` shows only files you meant to change. Nothing committed without being asked.
- [ ] Report what you ran and what you saw, what you did not verify, and anything you noticed but did not fix.

## Known baseline (2026-11-15)
- `pnpm typecheck`: clean.
- `pnpm test`: 40 files passed, 2 skipped (the live tests); 702 tests passed, 8 skipped.
- `pnpm build` and `pnpm e2e`: not recorded.
