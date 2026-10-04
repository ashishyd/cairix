import { z } from 'zod'
import { API_VERSION, SIMPLE_PERMISSIONS, type PluginManifest, type UiNode } from '@shared/plugins'

/** Everything a plugin tells us is untrusted input: validate strictly, reject rather than repair. */

const idPart = /^[a-z0-9][a-z0-9-]*$/
const contribId = z.string().regex(idPart).max(40)
const text = (max: number) => z.string().min(1).max(max)

const HOST = /^(?:\*\.)?(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i

export function permissionProblem(p: string): string | null {
  if (p in SIMPLE_PERMISSIONS) return null
  if (p.startsWith('network:')) return HOST.test(p.slice(8)) ? null : `"${p}" is not a valid host (use e.g. network:api.github.com)`
  return `Unknown permission "${p}"`
}

const contribution = z.object({ id: contribId, title: text(60), description: z.string().max(200).optional() })

const manifestSchema = z.object({
  apiVersion: z.literal(API_VERSION),
  // reverse-DNS style: letters/digits/hyphens separated by dots, at least two parts
  id: z.string().max(60).regex(/^[a-z0-9]+(?:[.-][a-z0-9]+)*\.[a-z0-9]+(?:[.-][a-z0-9]+)*$/, 'Use a dotted id like "acme.hello"'),
  name: text(60),
  version: z.string().regex(/^\d+\.\d+\.\d+$/, 'Use a version like 1.0.0'),
  description: z.string().max(300).optional(),
  author: z.string().max(80).optional(),
  main: z
    .string()
    .max(100)
    .regex(/^[A-Za-z0-9_\-./]+\.js$/, 'main must be a .js file inside the plugin folder')
    .refine((m) => !m.startsWith('/') && !m.split('/').includes('..') && !m.startsWith('.'), 'main must stay inside the plugin folder'),
  permissions: z.array(z.string()).max(20).default([]),
  contributes: z
    .object({
      commands: z.array(contribution).max(20).default([]),
      widgets: z.array(contribution.extend({ size: z.enum(['half', 'full']).optional() })).max(10).default([]),
      tabs: z.array(contribution).max(5).default([])
    })
    .default({ commands: [], widgets: [], tabs: [] })
})

export function parseManifest(raw: unknown): { ok: true; manifest: PluginManifest } | { ok: false; error: string } {
  const r = manifestSchema.safeParse(raw)
  if (!r.success) {
    const i = r.error.issues[0]
    return { ok: false, error: `${i.path.join('.') || 'manifest'}: ${i.message}` }
  }
  for (const p of r.data.permissions) {
    const bad = permissionProblem(p)
    if (bad) return { ok: false, error: `permissions: ${bad}` }
  }
  const ids = [...r.data.contributes.commands, ...r.data.contributes.widgets, ...r.data.contributes.tabs]
  if (new Set(ids.map((c) => c.id)).size !== ids.length) return { ok: false, error: 'contributes: ids must be unique across commands, widgets and tabs' }
  return { ok: true, manifest: { ...r.data, permissions: [...new Set(r.data.permissions)] } as PluginManifest }
}

// ───────────────────────── UI tree validation ─────────────────────────

const tone = z.enum(['neutral', 'accent', 'success', 'warning', 'danger'])
const short = (n: number) => z.string().max(n)
const listItem = z.object({ title: short(200), subtitle: short(300).optional(), badge: short(40).optional(), tone: tone.optional(), action: z.string().regex(idPart).max(40).optional(), payload: short(500).optional() })

const node: z.ZodType<UiNode> = z.lazy(() =>
  z.discriminatedUnion('type', [
    z.object({ type: z.literal('text'), text: short(2000), tone: tone.optional(), muted: z.boolean().optional() }),
    z.object({ type: z.literal('heading'), text: short(200) }),
    z.object({ type: z.literal('metric'), label: short(60), value: short(60), sub: short(120).optional() }),
    z.object({ type: z.literal('list'), items: z.array(listItem).max(100), empty: short(200).optional() }),
    z.object({ type: z.literal('button'), label: short(60), action: z.string().regex(idPart).max(40), payload: short(500).optional(), variant: z.enum(['primary', 'secondary']).optional() }),
    z.object({ type: z.literal('stack'), children: z.array(node).max(50), direction: z.enum(['column', 'row']).optional() }),
    z.object({ type: z.literal('progress'), value: z.number().min(0).max(1), label: short(80).optional() }),
    z.object({ type: z.literal('link'), text: short(120), url: short(500) }),
    z.object({ type: z.literal('badge'), text: short(40), tone: tone.optional() })
  ])
) as z.ZodType<UiNode>

const MAX_DEPTH = 6
const MAX_NODES = 400

function measure(n: UiNode, depth: number): { depth: number; nodes: number } {
  if (n.type !== 'stack') return { depth, nodes: 1 }
  return n.children.reduce((a, c) => {
    const m = measure(c, depth + 1)
    return { depth: Math.max(a.depth, m.depth), nodes: a.nodes + m.nodes }
  }, { depth, nodes: 1 })
}

/** Links a plugin can show must be https: a `javascript:` or `file:` link is dropped, not rendered. */
function cleanLinks(n: UiNode): UiNode {
  if (n.type === 'link') {
    try {
      return new URL(n.url).protocol === 'https:' ? n : { type: 'text', text: n.text, muted: true }
    } catch {
      return { type: 'text', text: n.text, muted: true }
    }
  }
  return n.type === 'stack' ? { ...n, children: n.children.map(cleanLinks) } : n
}

export function validateUi(raw: unknown): { ok: true; tree: UiNode } | { ok: false; error: string } {
  const r = node.safeParse(raw)
  if (!r.success) return { ok: false, error: `Invalid UI from plugin: ${r.error.issues[0].path.join('.') || 'root'}: ${r.error.issues[0].message}` }
  const m = measure(r.data, 1)
  if (m.depth > MAX_DEPTH) return { ok: false, error: `UI is nested too deeply (max ${MAX_DEPTH}).` }
  if (m.nodes > MAX_NODES) return { ok: false, error: `UI is too large (max ${MAX_NODES} elements).` }
  return { ok: true, tree: cleanLinks(r.data) }
}
