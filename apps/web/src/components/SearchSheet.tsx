import { useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { BottomSheet } from '@area-code/shared/components/BottomSheet'
import { api } from '@area-code/shared/lib/api'
import { useLocationStore } from '@area-code/shared/stores/locationStore'

interface SearchResult {
  id: string
  name: string
  slug: string
  category: string
  lat: number
  lng: number
}

interface SearchSheetProps {
  isOpen: boolean
  onClose: () => void
  onSelectNode: (result: SearchResult) => void
}

export function SearchSheet({ isOpen, onClose, onSelectNode }: SearchSheetProps) {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pos = useLocationStore((s) => s.lastKnownPosition)

  useEffect(() => {
    if (isOpen) inputRef.current?.focus()
  }, [isOpen])

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (query.length < 2) {
      setResults([])
      return
    }

    debounceRef.current = setTimeout(async () => {
      setLoading(true)
      try {
        const lat = pos?.lat ?? -26.2041
        const lng = pos?.lng ?? 28.0473
        const data = await api.get<SearchResult[]>(
          `/v1/nodes/search?q=${encodeURIComponent(query)}&lat=${lat}&lng=${lng}`,
        )
        setResults(data)
      } catch {
        setResults([])
      } finally {
        setLoading(false)
      }
    }, 300)

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [query, pos])

  return (
    <BottomSheet isOpen={isOpen} onClose={onClose}>
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t('search.placeholder')}
        className="w-full bg-[var(--bg-raised)] border border-[var(--border)] text-[var(--text-primary)] rounded-xl px-4 py-3 text-sm placeholder:text-[var(--text-muted)] focus:border-[var(--accent)] focus:outline-none mb-4"
      />

      {loading && (
        <p className="text-[var(--text-muted)] text-sm text-center py-4">
          {t('search.searching')}
        </p>
      )}

      {results.length > 0 && (
        <div className="flex flex-col gap-2 max-h-[50dvh] overflow-y-auto">
          {results.map((r) => (
            <button
              key={r.id}
              onClick={() => onSelectNode(r)}
              className="flex flex-row items-center gap-3 bg-[var(--bg-raised)] border border-[var(--border)] rounded-2xl px-4 py-3 text-left"
            >
              <div className="flex-1">
                <p className="text-[var(--text-primary)] text-sm font-medium">{r.name}</p>
                <p className="text-[var(--text-muted)] text-xs">{r.category}</p>
              </div>
            </button>
          ))}
        </div>
      )}

      {query.length >= 2 && !loading && results.length === 0 && (
        <p className="text-[var(--text-muted)] text-sm text-center py-4">
          {t('search.noResults')}
        </p>
      )}
    </BottomSheet>
  )
}

export type { SearchResult }
