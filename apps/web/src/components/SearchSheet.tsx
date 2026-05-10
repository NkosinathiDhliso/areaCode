import { useState, useEffect, useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { BottomSheet } from '@area-code/shared/components/BottomSheet'
import { Badge } from '@area-code/shared/components/Badge'
import { searchNodes, type SearchableNode, type SearchResult } from '@area-code/shared/lib/search'
import { useLocationStore } from '@area-code/shared/stores/locationStore'

const RECENT_SEARCHES_KEY = 'recent_searches'
const MAX_RECENT = 5

export { type SearchResult } from '@area-code/shared/lib/search'

export interface SearchSheetProps {
  isOpen: boolean
  onClose: () => void
  nodes: SearchableNode[]
  onSelectNode: (nodeId: string) => void
}

export function SearchSheet({ isOpen, onClose, nodes, onSelectNode }: SearchSheetProps) {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)
  const [recentSearches, setRecentSearches] = useState<string[]>([])
  const inputRef = useRef<HTMLInputElement>(null)
  const lastKnownPosition = useLocationStore((s) => s.lastKnownPosition)
  const userLat = lastKnownPosition?.lat ?? null
  const userLng = lastKnownPosition?.lng ?? null

  // Load recent searches
  useEffect(() => {
    try {
      const stored = localStorage.getItem(RECENT_SEARCHES_KEY)
      if (stored) setRecentSearches(JSON.parse(stored))
    } catch { /* ignore */ }
  }, [isOpen])

  // Focus input when opened
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 100)
    } else {
      setQuery('')
      setResults([])
      setError(false)
    }
  }, [isOpen])

  const handleSearch = useCallback((q: string) => {
    setQuery(q)
    if (!q.trim()) {
      setResults([])
      return
    }
    setLoading(true)
    setError(false)
    try {
      const filtered = searchNodes(q, nodes, userLat, userLng)
      setResults(filtered)
    } catch {
      setError(true)
    } finally {
      setLoading(false)
    }
  }, [nodes, userLat, userLng])

  function handleSelect(result: SearchResult) {
    // Save to recent searches
    const updated = [result.name, ...recentSearches.filter((s) => s !== result.name)].slice(0, MAX_RECENT)
    setRecentSearches(updated)
    try { localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(updated)) } catch { /* ignore */ }
    onSelectNode(result.id)
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && query.trim()) {
      handleSearch(query)
    }
  }

  function handleClear() {
    setQuery('')
    setResults([])
    inputRef.current?.focus()
  }

  // Nearby trending: top 3 by pulse within 2km
  const trending = nodes
    .filter((n) => {
      if (!userLat || !userLng) return true
      const R = 6371
      const toRad = (d: number) => (d * Math.PI) / 180
      const dLat = toRad(n.lat - userLat)
      const dLng = toRad(n.lng - userLng)
      const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(userLat)) * Math.cos(toRad(n.lat)) * Math.sin(dLng / 2) ** 2
      return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) <= 2
    })
    .sort((a, b) => b.pulseScore - a.pulseScore)
    .slice(0, 3)

  return (
    <BottomSheet isOpen={isOpen} onClose={onClose} title="Search" snapPoints={['half', 'full']}>
      {/* Search Input */}
      <div className="relative mb-4">
        <input
          ref={inputRef}
          type="search"
          value={query}
          onChange={(e) => handleSearch(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={t('search.placeholder', 'Search venues...')}
          className="w-full bg-[var(--bg-surface)] border border-[var(--border)] text-[var(--text-primary)] rounded-xl px-4 py-3 pr-10 text-sm placeholder:text-[var(--text-muted)] focus:border-[var(--accent)] focus:outline-none"
          aria-label="Search venues"
        />
        {query && (
          <button
            onClick={handleClear}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] text-lg"
            aria-label="Clear search"
          >
            ×
          </button>
        )}
      </div>

      {/* Content */}
      {loading ? (
        <SkeletonRows />
      ) : error ? (
        <div className="flex flex-col items-center py-8 gap-3">
          <span className="text-2xl">⚠️</span>
          <p className="text-[var(--text-secondary)] text-sm">Something went wrong</p>
          <button onClick={() => handleSearch(query)} className="text-[var(--accent)] text-sm font-medium">Try again</button>
        </div>
      ) : query && results.length === 0 ? (
        <div className="flex flex-col items-center py-8 gap-3">
          <span className="text-2xl">🔍</span>
          <p className="text-[var(--text-secondary)] text-sm text-center">No venues found for "{query}"</p>
          <p className="text-[var(--text-muted)] text-xs">Try a broader search term</p>
        </div>
      ) : results.length > 0 ? (
        <div className="flex flex-col gap-1">
          {results.map((r) => (
            <ResultRow key={r.id} result={r} onSelect={() => handleSelect(r)} />
          ))}
        </div>
      ) : (
        <>
          {/* Recent Searches */}
          {recentSearches.length > 0 && (
            <div className="mb-4">
              <h3 className="text-[var(--text-muted)] text-xs font-medium uppercase tracking-wider mb-2">Recent</h3>
              <div className="flex flex-col gap-1">
                {recentSearches.map((s) => (
                  <button key={s} onClick={() => handleSearch(s)} className="text-left text-[var(--text-primary)] text-sm py-2 px-3 rounded-lg hover:bg-[var(--bg-surface)]">
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}
          {/* Nearby Trending */}
          {trending.length > 0 && (
            <div>
              <h3 className="text-[var(--text-muted)] text-xs font-medium uppercase tracking-wider mb-2">Trending nearby</h3>
              <div className="flex flex-col gap-1">
                {trending.map((n) => (
                  <button key={n.id} onClick={() => onSelectNode(n.id)} className="flex items-center justify-between text-left py-2 px-3 rounded-lg hover:bg-[var(--bg-surface)]">
                    <div>
                      <span className="text-[var(--text-primary)] text-sm font-medium">{n.name}</span>
                      <span className="text-[var(--text-muted)] text-xs ml-2">{n.category}</span>
                    </div>
                    <Badge variant="pulse-state" label={n.state} />
                  </button>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </BottomSheet>
  )
}

function ResultRow({ result, onSelect }: { result: SearchResult; onSelect: () => void }) {
  return (
    <button onClick={onSelect} className="flex items-center justify-between py-3 px-3 rounded-lg hover:bg-[var(--bg-surface)] transition-colors w-full text-left">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-[var(--text-primary)] text-sm font-medium truncate">{result.name}</span>
          {result.isBoosted && <span className="w-2 h-2 rounded-full bg-[var(--color-boost-gold)]" title="Boosted" />}
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="text-[var(--text-muted)] text-xs capitalize">{result.category}</span>
          {result.distanceKm !== null && (
            <span className="text-[var(--text-muted)] text-xs">
              {result.distanceKm < 1 ? `${Math.round(result.distanceKm * 1000)}m` : `${result.distanceKm.toFixed(1)}km`}
            </span>
          )}
        </div>
      </div>
      <Badge variant="pulse-state" label={result.state} />
    </button>
  )
}

function SkeletonRows() {
  return (
    <div className="flex flex-col gap-3">
      {[1, 2, 3, 4].map((i) => (
        <div key={i} className="flex items-center justify-between py-3 px-3 animate-shimmer">
          <div className="flex-1">
            <div className="h-4 w-32 bg-[var(--border)] rounded mb-1" />
            <div className="h-3 w-20 bg-[var(--border)] rounded" />
          </div>
          <div className="h-5 w-14 bg-[var(--border)] rounded-full" />
        </div>
      ))}
    </div>
  )
}
