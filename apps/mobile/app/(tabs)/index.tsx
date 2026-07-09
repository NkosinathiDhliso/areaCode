import { ARCHETYPE_CATALOG } from '@area-code/shared/constants/archetype-catalog'
import { useGeolocation, useCheckIn } from '@area-code/shared/hooks'
import { api } from '@area-code/shared/lib/api'
import { useMapStore, useConsumerAuthStore, useLocationStore, useUserStore } from '@area-code/shared/stores'
import type { Node, NodeCategory } from '@area-code/shared/types'
import MapboxGL from '@rnmapbox/maps'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState, useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { View, Text, TouchableOpacity, TextInput, FlatList, StyleSheet } from 'react-native'

import { ArchetypeIcon } from '../../src/components/ArchetypeIcon'
import { CategoryFilterBar } from '../../src/components/CategoryFilterBar'
import { NodeDetailSheet } from '../../src/components/NodeDetailSheet'
import { ProximityNudgeBanner } from '../../src/components/ProximityNudgeBanner'
import { colors, getCategoryColour } from '../../src/theme'

const CITY_SLUG = 'johannesburg'
const DEFAULT_CENTER: [number, number] = [28.0473, -26.2041]
const SEARCH_DEBOUNCE_MS = 300
const DEFAULT_ARCHETYPE_ID = 'archetype-eclectic'
/**
 * Below this zoom the detailed archetype icon collapses to a simple category
 * dot, matching the web map. Default browse zoom is 13, so icons show by
 * default and only simplify at the city/region overview.
 */
const GLYPH_ZOOM_THRESHOLD = 12.5

/** iconId lookup keyed by archetype id, for fast marker rendering. */
const ARCHETYPE_ICON_ID_BY_ID: Record<string, string> = Object.fromEntries(
  ARCHETYPE_CATALOG.map((a) => [a.id, a.iconId]),
)

interface SearchResult {
  id: string
  name: string
  slug: string
  category: string
  lat: number
  lng: number
}

export default function MapScreen() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const { setNodes, pulseScores } = useMapStore()
  const archetypeIds = useMapStore((s) => s.archetypeIds)
  const _accessToken = useConsumerAuthStore((s) => s.accessToken)
  const permissionState = useLocationStore((s) => s.permissionState)
  const { onboarding, markHintSeen } = useUserStore()
  const { requestLocation, geoStatus } = useGeolocation()
  const { checkIn, qrFallback: _qrFallback, resetQrFallback } = useCheckIn()

  const [selectedNode, setSelectedNode] = useState<Node | null>(null)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [categoryFilter, setCategoryFilter] = useState<NodeCategory | null>(null)
  const [browseOnly, setBrowseOnly] = useState(false)
  const [cameraCenter, setCameraCenter] = useState(DEFAULT_CENTER)
  // Show the detailed archetype icon at/above the threshold zoom; collapse to a
  // simple category dot when zoomed out so a packed city overview stays legible.
  const [showIcon, setShowIcon] = useState(true)

  const handleCameraChanged = useCallback((state: { properties?: { zoom?: number } }) => {
    const zoom = state.properties?.zoom
    if (typeof zoom !== 'number') return
    setShowIcon((prev) => {
      const next = zoom >= GLYPH_ZOOM_THRESHOLD
      return prev === next ? prev : next
    })
  }, [])

  // Search state
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<SearchResult[]>([])
  const [searchLoading, setSearchLoading] = useState(false)
  const [showSearchResults, setShowSearchResults] = useState(false)
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const { data: nodeList } = useQuery({
    queryKey: ['nodes', CITY_SLUG],
    queryFn: () => api.get<Node[]>(`/v1/nodes/${CITY_SLUG}`),
    staleTime: 30_000,
  })

  useEffect(() => {
    if (nodeList) setNodes(nodeList)
  }, [nodeList, setNodes])

  useEffect(() => {
    void requestLocation().then((pos) => {
      if (pos) setCameraCenter([pos.lng, pos.lat])
    })
  }, [])

  // Debounced search
  useEffect(() => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current)

    if (searchQuery.length < 2) {
      setSearchResults([])
      setShowSearchResults(false)
      return
    }

    setSearchLoading(true)
    searchTimerRef.current = setTimeout(async () => {
      try {
        const [lng, lat] = cameraCenter
        const res = await api.get<SearchResult[]>(
          `/v1/nodes/search?q=${encodeURIComponent(searchQuery)}&lat=${lat}&lng=${lng}`,
        )
        setSearchResults(res)
        setShowSearchResults(true)
      } catch {
        setSearchResults([])
      } finally {
        setSearchLoading(false)
      }
    }, SEARCH_DEBOUNCE_MS)

    return () => {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
    }
  }, [searchQuery])

  const handleSearchResultTap = useCallback((result: SearchResult) => {
    const node: Node = {
      id: result.id,
      name: result.name,
      slug: result.slug,
      category: result.category as NodeCategory,
      lat: result.lat,
      lng: result.lng,
      cityId: '',
      businessId: null,
      submittedBy: null,
      claimStatus: 'unclaimed',
      claimCipcStatus: null,
      nodeColour: 'default',
      nodeIcon: null,
      qrCheckinEnabled: false,
      isVerified: false,
      isActive: true,
      createdAt: '',
    }
    setSelectedNode(node)
    setSheetOpen(true)
    setCameraCenter([result.lng, result.lat])
    setSearchQuery('')
    setShowSearchResults(false)
  }, [])

  const handleClearSearch = useCallback(() => {
    setSearchQuery('')
    setSearchResults([])
    setShowSearchResults(false)
  }, [])

  const handleNodePress = useCallback(
    (node: Node) => {
      setSelectedNode(node)
      setSheetOpen(true)
      resetQrFallback()
      if (!onboarding.hintSeen) markHintSeen('hintSeen')
    },
    [onboarding.hintSeen, markHintSeen, resetQrFallback],
  )

  // Proximity nudge "Check in" tap: locate the node in the loaded list and
  // open its detail sheet so the user can complete the check-in.
  const handleProximityCheckIn = useCallback(
    (nodeId: string) => {
      const node = nodeList?.find((n) => n.id === nodeId)
      if (node) {
        setSelectedNode(node)
        setSheetOpen(true)
        resetQrFallback()
      }
    },
    [nodeList, resetQrFallback],
  )

  async function handleCheckIn() {
    if (!selectedNode) return
    const pos = await requestLocation()
    if (!pos && geoStatus !== 'poorAccuracy') return

    const result = await checkIn({
      nodeId: selectedNode.id,
      type: 'reward' as const,
      ...(pos ? { lat: pos.lat, lng: pos.lng } : {}),
    })

    if (result) {
      setSheetOpen(false)
      void queryClient.invalidateQueries({ queryKey: ['nodes'] })
      if (!onboarding.firstCheckIn) markHintSeen('firstCheckIn')
    }
  }

  const filteredNodes = nodeList?.filter((n) => !categoryFilter || n.category === categoryFilter) ?? []

  const showPermissionPrompt = permissionState === 'denied' && !browseOnly

  if (showPermissionPrompt) {
    return (
      <View style={styles.permissionContainer}>
        <Text style={styles.permissionTitle}>{t('location.permissionTitle')}</Text>
        <TouchableOpacity style={styles.primaryButton} onPress={() => void requestLocation()}>
          <Text style={styles.primaryButtonText}>{t('location.enable')}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.secondaryButton} onPress={() => setBrowseOnly(true)}>
          <Text style={styles.secondaryButtonText}>{t('location.browseOnly')}</Text>
        </TouchableOpacity>
      </View>
    )
  }

  return (
    <View style={styles.container}>
      <MapboxGL.MapView
        style={styles.map}
        styleURL="mapbox://styles/mapbox/dark-v11"
        onCameraChanged={handleCameraChanged}
      >
        <MapboxGL.Camera
          centerCoordinate={cameraCenter}
          zoomLevel={13}
          animationMode="flyTo"
          animationDuration={1000}
        />
        {filteredNodes.map((node) => {
          const archetypeId = archetypeIds[node.id] ?? node.defaultArchetypeId ?? DEFAULT_ARCHETYPE_ID
          const iconId = ARCHETYPE_ICON_ID_BY_ID[archetypeId] ?? 'eclectic'
          const isActive = (pulseScores[node.id] ?? 0) > 0
          const categoryColour = getCategoryColour(node.category)
          return (
            <MapboxGL.PointAnnotation
              key={`${node.id}-${showIcon ? 'icon' : 'dot'}`}
              id={node.id}
              coordinate={[node.lng, node.lat]}
              onSelected={() => handleNodePress(node)}
            >
              <View style={[styles.marker, { opacity: isActive ? 1 : 0.6 }]}>
                {showIcon ? (
                  <ArchetypeIcon iconId={iconId} size={26} color={categoryColour} />
                ) : (
                  <View style={[styles.markerDot, { backgroundColor: categoryColour }]} />
                )}
              </View>
            </MapboxGL.PointAnnotation>
          )
        })}
      </MapboxGL.MapView>

      {/* Search bar */}
      <View style={styles.searchOverlay}>
        <View style={styles.searchContainer}>
          <TextInput
            style={styles.searchInput}
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder={t('map.searchPlaceholder', { defaultValue: 'Search venues...' })}
            placeholderTextColor={colors.textMuted}
            returnKeyType="search"
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity onPress={handleClearSearch} style={styles.clearButton}>
              <Text style={styles.clearButtonText}>✕</Text>
            </TouchableOpacity>
          )}
        </View>

        {showSearchResults && (
          <View style={styles.searchResultsContainer}>
            {searchLoading ? (
              <View style={styles.searchResultItem}>
                <Text style={styles.searchResultMuted}>Searching...</Text>
              </View>
            ) : searchResults.length === 0 ? (
              <View style={styles.searchResultItem}>
                <Text style={styles.searchResultMuted}>{t('map.noResults', { defaultValue: 'No results found' })}</Text>
              </View>
            ) : (
              <FlatList
                data={searchResults}
                keyExtractor={(item) => item.id}
                keyboardShouldPersistTaps="handled"
                style={styles.searchResultsList}
                renderItem={({ item }) => (
                  <TouchableOpacity style={styles.searchResultItem} onPress={() => handleSearchResultTap(item)}>
                    <Text style={styles.searchResultName}>{item.name}</Text>
                    <Text style={styles.searchResultCategory}>{item.category}</Text>
                  </TouchableOpacity>
                )}
              />
            )}
          </View>
        )}
      </View>

      <View style={styles.filterOverlay}>
        <CategoryFilterBar onFilter={setCategoryFilter} />
      </View>

      <ProximityNudgeBanner onCheckIn={handleProximityCheckIn} />

      {!onboarding.hintSeen && (
        <View style={styles.hintOverlay}>
          <View style={styles.hintBox}>
            <Text style={styles.hintText}>{t('map.tapHint')}</Text>
            <TouchableOpacity onPress={() => markHintSeen('hintSeen')}>
              <Text style={styles.hintDismiss}>X</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      <NodeDetailSheet
        node={selectedNode}
        pulseScore={selectedNode ? (pulseScores[selectedNode.id] ?? 0) : 0}
        isOpen={sheetOpen}
        onClose={() => setSheetOpen(false)}
        onCheckIn={handleCheckIn}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  map: { flex: 1 },
  searchOverlay: {
    position: 'absolute',
    top: 50,
    left: 12,
    right: 12,
    zIndex: 20,
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.bgRaised,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 12,
  },
  searchInput: {
    flex: 1,
    color: colors.textPrimary,
    fontSize: 14,
    paddingVertical: 12,
  },
  clearButton: {
    padding: 4,
  },
  clearButtonText: {
    color: colors.textMuted,
    fontSize: 14,
  },
  searchResultsContainer: {
    backgroundColor: colors.bgRaised,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    marginTop: 4,
    maxHeight: 240,
    overflow: 'hidden',
  },
  searchResultsList: {
    maxHeight: 240,
  },
  searchResultItem: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  searchResultName: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: '500',
  },
  searchResultCategory: {
    color: colors.textMuted,
    fontSize: 11,
    textTransform: 'capitalize',
    marginTop: 2,
  },
  searchResultMuted: {
    color: colors.textMuted,
    fontSize: 13,
  },
  filterOverlay: {
    position: 'absolute',
    top: 110,
    left: 0,
    right: 0,
    zIndex: 10,
  },
  hintOverlay: {
    position: 'absolute',
    top: '50%',
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 10,
  },
  hintBox: {
    backgroundColor: colors.bgRaised,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  hintText: { color: colors.textSecondary, fontSize: 13 },
  hintDismiss: { color: colors.textMuted, fontSize: 12 },
  marker: { width: 30, height: 30, alignItems: 'center', justifyContent: 'center' },
  markerDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 1.5,
    borderColor: 'rgba(0,0,0,0.25)',
  },
  permissionContainer: {
    flex: 1,
    backgroundColor: colors.bgSurface,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  permissionTitle: {
    color: colors.textPrimary,
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 24,
    textAlign: 'center',
  },
  primaryButton: {
    width: '100%',
    backgroundColor: colors.accent,
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    marginBottom: 12,
  },
  primaryButtonText: { color: '#fff', fontWeight: '600', fontSize: 16 },
  secondaryButton: {
    width: '100%',
    backgroundColor: colors.bgRaised,
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  secondaryButtonText: { color: colors.textSecondary, fontWeight: '600', fontSize: 16 },
})
