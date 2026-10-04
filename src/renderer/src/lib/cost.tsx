import { useAgentsStore } from '@/stores/agents-store'
import { formatCost } from '@shared/cost'

export function useIsSubscription(): boolean {
  return useAgentsStore((s) => s.snapshot?.claude.billing === 'subscription')
}

export const SUBSCRIPTION_NOTE = 'Signed in with your Claude subscription: runs are not billed per use. Dollar figures are API-price equivalents that count toward your plan limits.'

/** Inline cost with a tooltip explaining what the figure means for the signed-in account. */
export function Cost({ usd, digits = 3, limit = false }: { usd: number; digits?: number; limit?: boolean }): React.JSX.Element {
  const sub = useIsSubscription()
  return (
    <span title={sub ? SUBSCRIPTION_NOTE : undefined}>
      {limit && sub ? `${formatCost(usd, true, digits)} (cap)` : formatCost(usd, sub, digits)}
    </span>
  )
}
