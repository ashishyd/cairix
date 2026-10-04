import { FolderPlus, GitCompare, Play, Plug, ShieldCheck, Zap, type LucideIcon } from 'lucide-react'
import { BrandLogo } from '@/components/BrandLogo'
import { GettingStarted } from '@/components/GettingStarted'
import { Button, EmptyState, PageHeader } from '@/components/ui'
import { Dashboard } from '@/modules/dashboard/Dashboard'
import { useProjectsStore } from '@/stores/projects-store'
import { useUiStore } from '@/stores/ui-store'

export function HomeView(): React.JSX.Element {
  const setAddFolder = useUiStore((s) => s.setAddFolder)
  const workspaces = useProjectsStore((s) => s.workspaces)

  if (workspaces.length === 0) {
    const tips: Array<[LucideIcon, string]> = [
      [ShieldCheck, 'Trust a folder once — then scripts, tasks and audits can run safely'],
      [Play, 'One-click scripts for every package.json, Python and Make target'],
      [Plug, 'See every dev server, its port and memory, and stop it safely'],
      [GitCompare, 'Review pending changes, fix with Claude, and learn why'],
      [Zap, 'Press ⌘K to find and run anything']
    ]
    return (
      <div className="mx-auto max-w-[640px] px-page-x pt-12">
        <div className="mb-6 flex flex-col items-center text-center animate-fade">
          <BrandLogo size={56} />
          <p className="mt-4 text-base font-medium tracking-wide text-cx-accent-text">Cairix</p>
          <p className="mt-1 text-lg text-cx-muted">Run it, fix it, learn it.</p>
        </div>
        <EmptyState icon={FolderPlus} title="Add your first folder" action={<Button variant="primary" icon={FolderPlus} onClick={() => setAddFolder(true)}>Add folder…</Button>}>
          Point Cairix at a project, or at a folder full of them. It finds nested apps in monorepos automatically.
        </EmptyState>
        <ul className="mx-auto mt-2 grid max-w-md gap-3 text-cx-muted">
          {tips.map(([Icon, text]) => (
            <li key={text} className="flex items-start gap-3"><Icon size={15} className="mt-0.5 shrink-0 text-cx-accent-text" /> {text}</li>
          ))}
        </ul>
      </div>
    )
  }

  const projectCount = workspaces.reduce((n, w) => n + w.projects.length, 0)

  return (
    <div className="mx-auto max-w-[1000px] px-page-x py-page-y">
      <PageHeader
        title="Home"
        subtitle={`${projectCount} project${projectCount === 1 ? '' : 's'} · everything running on this Mac, at a glance.`}
        actions={<Button size="sm" icon={FolderPlus} onClick={() => setAddFolder(true)}>Add folder</Button>}
      />
      <GettingStarted />
      <Dashboard />
    </div>
  )
}
