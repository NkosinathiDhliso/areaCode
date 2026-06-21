import { useEffect, useRef, useState } from 'react'

/**
 * Address autocomplete backed by the Mapbox Geocoding v6 forward endpoint.
 *
 * Replaces the previous Google Places Autocomplete on the venue add/edit
 * surfaces. Mapbox is already the basemap provider for the consumer app
 * (`VITE_MAPBOX_TOKEN`), so this consolidates on a single vendor, stays inside
 * Mapbox's free geocoding tier at our volume, and removes the Google Cloud
 * billing/key dependency that surfaced the "This page can't load Google Maps
 * correctly" dialog on the business portal.
 *
 * The component is self-contained: it debounces typing, queries the forward
 * geocoder restricted to South Africa, renders a suggestion dropdown, and
 * reports the chosen formatted address plus its coordinates via {@link onSelect}.
 * Free-typed text (no suggestion picked) is still reported via {@link onTextChange}
 * so manual entry keeps working when geocoding is unavailable.
 */

const MAPBOX_TOKEN = import.meta.env['VITE_MAPBOX_TOKEN'] as string | undefined
const ENDPOINT = 'https://api.mapbox.com/search/geocode/v6/forward'
const DEBOUNCE_MS = 300

interface MapboxFeature {
  properties?: {
    full_address?: string
    name?: string
    coordinates?: { longitude?: number; latitude?: number }
  }
}

export interface AddressSelection {
  address: string
  lat: number
  lng: number
}

interface MapboxAddressInputProps {
  /** Controlled text value of the input. */
  value: string
  /** Fired on every keystroke with the raw typed text (clears any prior coords). */
  onTextChange: (text: string) => void
  /** Fired when the user picks a suggestion (carries resolved coordinates). */
  onSelect: (selection: AddressSelection) => void
  placeholder?: string
  className?: string
  inputRef?: React.Ref<HTMLInputElement>
  /** Fired once if Mapbox is unreachable / unconfigured, so the parent can hint manual entry. */
  onUnavailable?: () => void
}

export function MapboxAddressInput({
  value,
  onTextChange,
  onSelect,
  placeholder,
  className,
  inputRef,
  onUnavailable,
}: MapboxAddressInputProps) {
  const [suggestions, setSuggestions] = useState<MapboxFeature[]>([])
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  // Suppress the next fetch when value changes because the user just picked a suggestion.
  const skipNextFetch = useRef(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!MAPBOX_TOKEN) {
      onUnavailable?.()
      return
    }
    if (skipNextFetch.current) {
      skipNextFetch.current = false
      return
    }
    const query = value.trim()
    if (query.length < 3) {
      setSuggestions([])
      setOpen(false)
      return
    }

    const controller = new AbortController()
    const handle = setTimeout(() => {
      // Note: `poi` is NOT a valid type for the Geocoding v6 API (it only exists
      // in the Search Box API) and including it returns HTTP 422. Geocoding v6
      // supports: country, region, postcode, district, place, locality,
      // neighborhood, street, address.
      const url =
        `${ENDPOINT}?q=${encodeURIComponent(query)}` +
        `&country=za&limit=5&types=address,street,place&autocomplete=true` +
        `&access_token=${MAPBOX_TOKEN}`
      fetch(url, { signal: controller.signal })
        .then((res) => {
          if (!res.ok) throw new Error(`Mapbox geocoding failed (${res.status})`)
          return res.json() as Promise<{ features?: MapboxFeature[] }>
        })
        .then((data) => {
          const features = data.features ?? []
          setSuggestions(features)
          setOpen(features.length > 0)
          setActiveIndex(-1)
        })
        .catch((err: unknown) => {
          if ((err as { name?: string })?.name === 'AbortError') return
          console.error('[AreaCode] Mapbox geocoding error', err)
          setSuggestions([])
          setOpen(false)
        })
    }, DEBOUNCE_MS)

    return () => {
      clearTimeout(handle)
      controller.abort()
    }
  }, [value, onUnavailable])

  // Close the dropdown when clicking outside.
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [])

  function choose(feature: MapboxFeature) {
    const address = feature.properties?.full_address || feature.properties?.name || ''
    const coords = feature.properties?.coordinates
    skipNextFetch.current = true
    setOpen(false)
    setSuggestions([])
    setActiveIndex(-1)
    if (address && coords?.latitude !== undefined && coords?.longitude !== undefined) {
      onSelect({ address, lat: coords.latitude, lng: coords.longitude })
    } else if (address) {
      onTextChange(address)
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || suggestions.length === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIndex((i) => (i + 1) % suggestions.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex((i) => (i - 1 + suggestions.length) % suggestions.length)
    } else if (e.key === 'Enter' && activeIndex >= 0) {
      e.preventDefault()
      const picked = suggestions[activeIndex]
      if (picked) choose(picked)
    } else if (e.key === 'Escape') {
      setOpen(false)
    }
  }

  return (
    <div ref={containerRef} className="relative">
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => onTextChange(e.target.value)}
        onKeyDown={onKeyDown}
        onFocus={() => suggestions.length > 0 && setOpen(true)}
        placeholder={placeholder}
        autoComplete="off"
        className={className}
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
      />
      {open && suggestions.length > 0 && (
        <ul
          role="listbox"
          className="absolute z-10 mt-1 w-full max-h-60 overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--bg-modal)] shadow-2xl"
        >
          {suggestions.map((feature, i) => {
            const label = feature.properties?.full_address || feature.properties?.name || ''
            return (
              <li
                key={`${label}-${i}`}
                role="option"
                aria-selected={i === activeIndex}
                onMouseDown={(e) => {
                  e.preventDefault()
                  choose(feature)
                }}
                onMouseEnter={() => setActiveIndex(i)}
                className={`cursor-pointer px-4 py-2.5 text-sm text-[var(--text-primary)] ${
                  i === activeIndex ? 'bg-[var(--bg-raised)]' : ''
                }`}
              >
                {label}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
