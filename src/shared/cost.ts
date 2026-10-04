/**
 * Formats the CLI's reported cost. On a subscription login nothing is charged per run, so the
 * figure is shown as an API-price equivalent of plan usage; with an API key it's real spend.
 */
export function formatCost(usd: number, subscription: boolean, digits = 3): string {
  const n = usd.toFixed(digits)
  return subscription ? `≈$${n} of plan usage` : `$${n}`
}
