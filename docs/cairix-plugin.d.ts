// Types for writing a Cairix plugin. Add `/// <reference path="cairix-plugin.d.ts" />` to your plugin,
// or copy this file next to it. The `cairix` global exists only inside a plugin's sandbox.

type Tone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger'

interface ListItem { title: string; subtitle?: string; badge?: string; tone?: Tone; action?: string; payload?: string }

/** What a widget or tab returns. Cairix validates it and draws it; plugins never supply HTML. */
type UiNode =
  | { type: 'text'; text: string; tone?: Tone; muted?: boolean }
  | { type: 'heading'; text: string }
  | { type: 'metric'; label: string; value: string; sub?: string }
  | { type: 'list'; items: ListItem[]; empty?: string }
  | { type: 'button'; label: string; action: string; payload?: string; variant?: 'primary' | 'secondary' }
  | { type: 'stack'; children: UiNode[]; direction?: 'column' | 'row' }
  | { type: 'progress'; value: number; label?: string }
  | { type: 'link'; text: string; url: string }
  | { type: 'badge'; text: string; tone?: Tone }

interface PluginProject { id: string; name: string; path: string; kinds: string[] }
interface PluginPort { port: number; name: string; framework?: string; project?: string; memoryKb: number; category: string }
interface PluginAgent { title: string; kind: string; status: string; project?: string }
interface HttpResponse { status: number; ok: boolean; contentType: string; text: string }

declare const cairix: {
  plugin: {
    /** Call once, at load. Everything you contribute in the manifest needs a matching function here. */
    register(def: {
      commands?: Record<string, () => void | Promise<void>>
      widgets?: Record<string, () => UiNode | Promise<UiNode>>
      tabs?: Record<string, (ctx: { projectId?: string }) => UiNode | Promise<UiNode>>
      /** Called when a button or list row naming this action is clicked. The widget is then drawn again. */
      actions?: Record<string, (ctx: { payload?: string; kind: 'widget' | 'tab'; contribId: string; projectId?: string }) => void | Promise<void>>
    }): void
  }
  /** Needs "projects.read" */ projects: { list(): Promise<PluginProject[]> }
  /** Needs "ports.read" */ ports: { list(): Promise<PluginPort[]> }
  /** Needs "agents.read" */ agents: { list(): Promise<PluginAgent[]> }
  /** Needs "storage". 256 KB per key, 1 MB total, private to your plugin. */
  storage: { get(key: string): Promise<unknown>; set(key: string, value: unknown): Promise<null>; delete(key: string): Promise<null>; keys(): Promise<string[]> }
  /** Needs "network:<host>" for each host you contact. https only. 1 MB response limit. */
  http: { fetch(url: string, options?: { method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'; headers?: Record<string, string>; body?: string }): Promise<HttpResponse> }
  ui: {
    /** Needs "notify" */ notify(message: string, kind?: 'info' | 'success' | 'error'): Promise<null>
    /** Needs "openUrl". https only. */ openUrl(url: string): Promise<null>
  }
}
