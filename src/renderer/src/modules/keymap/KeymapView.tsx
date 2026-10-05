import { Keyboard, Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import { keyLabels, KEYMAPS, PLATFORM_LABEL, platformOf, searchKeymap } from '@shared/keymap'
import { Chip, EmptyState, Kbd } from '@/components/ui'

/** The system Cairix is running on. Only its shortcuts are shown: a Mac user never sees "Ctrl+C = copy". */
const PLATFORM = platformOf(typeof navigator === 'undefined' ? 'linux' : navigator.platform)

export function KeymapView(): React.JSX.Element {
  const [query, setQuery] = useState('')
  const groups = useMemo(() => searchKeymap(PLATFORM, query), [query])
  const total = KEYMAPS[PLATFORM].reduce((a, g) => a + g.items.length, 0)
  const shown = groups.reduce((a, g) => a + g.items.length, 0)

  return (
    <div className="mx-auto max-w-[900px] px-page-x py-page-y">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight">Keymap <Chip tone="accent">{PLATFORM_LABEL[PLATFORM]}</Chip></h1>
          <p className="mt-0.5 text-cx-muted">{total} shortcuts for your system: everyday use, text, files, the browser, the terminal and your code editor.</p>
        </div>
        <label className="no-drag flex h-8 w-64 items-center gap-2 rounded-lg border border-cx-border bg-cx-raised px-2.5 focus-within:border-cx-accent">
          <Search size={14} className="text-cx-faint" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find a shortcut" aria-label="Find a shortcut" className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-cx-faint" />
        </label>
      </div>

      {groups.length === 0 ? (
        <EmptyState icon={Keyboard} title="No shortcut matches that">Try a key (“Cmd”), or what it does (“screenshot”, “delete word”).</EmptyState>
      ) : (
        <div className="space-y-4">
          {groups.map((g) => (
            <section key={g.id} aria-label={g.title} className="overflow-hidden rounded-xl border border-cx-border bg-cx-raised">
              <header className="border-b border-cx-border bg-cx-surface px-4 py-2">
                <h2 className="cx-label">{g.title}</h2>
                {g.note && <p className="mt-0.5 text-sm normal-case text-cx-faint">{g.note}</p>}
              </header>
              <ul>
                {g.items.map((i) => (
                  <li key={`${i.does}:${i.keys.join('+')}`} className="flex items-center justify-between gap-4 border-b border-cx-border/60 px-4 py-2 last:border-0">
                    <span>{i.does}</span>
                    <span className="flex shrink-0 items-center gap-1" aria-label={i.keys.join(' + ')}>
                      {keyLabels(i.keys, PLATFORM).map((label, n) => <Kbd key={n}>{label}</Kbd>)}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
      {query && <p className="mt-3 text-sm text-cx-faint">{shown} of {total} shown</p>}
    </div>
  )
}
