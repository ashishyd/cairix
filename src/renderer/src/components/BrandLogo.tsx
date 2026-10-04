/**
 * The Cairix mark: three stacked stones (a cairn) on the family's navy tile.
 * Small sizes use chunkier stones and drop the amber spark so it stays legible,
 * matching the simplified variants used for the macOS icon at ≤40px.
 */
export function BrandLogo({ size = 28, rounded = true }: { size?: number; rounded?: boolean }): React.JSX.Element {
  const small = size <= 32
  return (
    <svg width={size} height={size} viewBox="0 0 1024 1024" role="img" aria-label="Cairix" className="shrink-0">
      <rect width="1024" height="1024" rx={rounded ? 228 : 0} fill="#0B1226" />
      {small ? (
        <>
          <rect x="202" y="590" width="620" height="180" rx="90" fill="#3A6FE0" />
          <rect x="272" y="410" width="450" height="160" rx="80" fill="#8FB5FA" />
          <rect x="392" y="240" width="260" height="150" rx="75" fill="#10B981" />
        </>
      ) : (
        <>
          <rect x="222" y="590" width="580" height="170" rx="85" fill="#3A6FE0" />
          <rect x="282" y="420" width="430" height="150" rx="75" fill="#8FB5FA" />
          <rect x="402" y="270" width="240" height="130" rx="65" fill="#10B981" />
          <circle cx="696" cy="248" r="24" fill="#F59E0B" />
        </>
      )}
    </svg>
  )
}
