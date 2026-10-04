# Writing a Cairix plugin

A plugin adds **dashboard widgets**, **project tabs** and **commands** (in ⌘K) to Cairix. It is a folder with two files:

```
my-plugin/
  cairix-plugin.json   what it is, what it contributes, what it needs
  index.js             the code
```

See `examples/plugin-hello` for a complete working plugin, and `docs/cairix-plugin.d.ts` for editor autocomplete.

Install it from **Machine → Plugins → Install plugin…**, then review its permissions and enable it.

## The manifest

```json
{
  "apiVersion": 1,
  "id": "acme.hello",
  "name": "Hello",
  "version": "1.0.0",
  "main": "index.js",
  "permissions": ["projects.read", "storage", "network:api.github.com"],
  "contributes": {
    "widgets":  [{ "id": "counter", "title": "Hello counter", "size": "half" }],
    "tabs":     [{ "id": "projects", "title": "Hello" }],
    "commands": [{ "id": "say", "title": "Say hello" }]
  }
}
```

- `id` is dotted and lower-case (`acme.hello`). It names the install folder, so it cannot contain paths.
- `main` must be a `.js` file inside the folder.
- Every contribution id must be unique and match a function you register.

## The code

```js
cairix.plugin.register({
  widgets:  { counter: async () => ({ type: 'metric', label: 'Projects', value: String((await cairix.projects.list()).length) }) },
  tabs:     { projects: async ({ projectId }) => ({ type: 'text', text: 'Viewing ' + projectId }) },
  commands: { say: async () => { await cairix.ui.notify('Hello!') } },
  actions:  { bump: async () => { /* called when a button/row with action "bump" is clicked */ } }
})
```

Widgets and tabs are re-drawn about every 10 seconds while visible, and immediately after one of your actions runs.

## What you return: UI nodes

You return a *description*; Cairix draws it with its own components, so plugins look native and cannot inject HTML or script.

| node | fields |
|---|---|
| `text` | `text`, `tone?`, `muted?` |
| `heading` | `text` |
| `metric` | `label`, `value`, `sub?` |
| `list` | `items: [{ title, subtitle?, badge?, tone?, action?, payload? }]`, `empty?` |
| `button` | `label`, `action`, `payload?`, `variant?` |
| `stack` | `children`, `direction?: 'column' \| 'row'` |
| `progress` | `value` (0 to 1), `label?` |
| `link` | `text`, `url` (https only; anything else is shown as plain text) |
| `badge` | `text`, `tone?` |

Limits: 6 levels deep, 400 elements, 100 list items, text up to 2000 characters. Invalid output is rejected with a message in the widget.

## Permissions

Declared in the manifest, shown to the user in plain words before they enable the plugin, and enforced by Cairix on every call. If an update asks for a new permission, the plugin stops until the user approves it again.

| permission | lets you |
|---|---|
| `projects.read` | `cairix.projects.list()` |
| `ports.read` | `cairix.ports.list()` (never includes command lines) |
| `agents.read` | `cairix.agents.list()` |
| `storage` | `cairix.storage.*` (256 KB per key, 1 MB total, private to you) |
| `notify` | `cairix.ui.notify()` |
| `openUrl` | `cairix.ui.openUrl()` (https only) |
| `network:host` | `cairix.http.fetch()` to that host. `network:*.example.com` allows subdomains. |

## The sandbox (what you do NOT have)

Your code runs in its own invisible, Chromium-sandboxed window. There is no Node, no `require`, no `process`, no filesystem, no `fetch`/`XMLHttpRequest`/WebSocket (blocked), no popups, and no scripts loaded from elsewhere. The only way out is the `cairix` object. A call that takes more than 8 seconds is abandoned; a plugin that stops responding is switched off.

`cairix.http.fetch` is https-only, honours the host allow-list on **every redirect hop**, drops cookie/host headers, never sends credentials, and caps requests (10 s) and responses (1 MB).

## Install rules

The folder is copied, not run in place. It may not contain symlinks, more than 200 files or 5 MB; `main` may not exceed 500 KB. `node_modules` and `.git` are skipped, so bundle your dependencies into one file.

## Testing

`tests/e2e/fixtures/plugin-rogue` is a plugin that asks for no permissions and tries eleven ways to escape. The end-to-end test fails if any succeed.
