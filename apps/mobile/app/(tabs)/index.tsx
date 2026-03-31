import { useEffect, useState, useCallback } from 'react'
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import { useTranslation } from 'react-i18next'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import MapboxGL from '@rnmapbox/maps'

import { api } from '@area-code/shared/lib/api'
import { useMapStore, useConsumerAuthStore, useLocationStore, useUserStore } from '@area-code/shared/stores'
import { useGeolocation, useCheckIn } from '@area-code/shared/hooks'
import type { Node, NodeCategory } from '@area-code/shared/types'

import { CategoryFilterBar } from '../../src/components/CategoryFilterBar'
import { NodeDetailSheet } from '../../src/components/NodeDetailSheet'
import { colors } from '../../src/theme'

const CITY_SLUG = 'johannesburg'
const DEFAULT_CENTER: [number, number] = [28.0473, -26.2041]

export default function MapScreen() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const { setNodes, pulseScores } = useMapStore()
  const accessToken = useConsumerAuthStore((s) => s.accessToken)
  const permissionState = useLocationStore((s) => s.permissionState)
  const { onboarding, markHintSeen } = useUserStore()
  const { requestLocation, geoStatus } = useGeolocation()
  const { checkIn, qrFallback, resetQrFallback } = useCheckIn()

  const [selectedNode, setSelectedNode] = useState<Node | null>(null)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [categoryFilter, setCategoryFilter] = useState<NodeCategory | null>(null)
  const [browseOnly, setBrowseOnly] = useState(false)
  const [cameraCenter, setCameraCenter] = useState(DEFAULT_CENTER)

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

  const handleNodePress = useCallback((node: Node) => {
    setSelectedNode(node)
    setSheetOpen(true)
    resetQrFallback()
    if (!onboarding.hintSeen) markHintSeen('hintSeen')
  }, [onboarding.hintSeen, markHintSeen, resetQrFallback])

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

  const filteredNodes = nodeList?.filter(
    (n) => !categoryFilter || n.category === categoryFilter,
  ) ?? []

  const showPermissionPrompt = permissionState === 'denied' && !browseOnly

  if (showPermissionPrompt) {
    return (
      <View style={styles.permissionContainer}>
        <Text style={styles.permissionTitle}>{t('location.permissionTitle')}</Text>
        <TouchableOpacity
          style={styles.primaryButton}
          onPress={() => void requestLocation()}
        >
          <Text style={styles.primaryButtonText}>{t('location.enable')}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.secondaryButton}
          onPress={() => setBrowseOnly(true)}
        >
          <Text style={styles.secondaryButtonText}>{t('location.browseOnly')}</Text>
        </TouchableOpacity>
      </View>
    )
  }

  return (
    <View style={styles.container}>
      <MapboxGL.MapView style={styles.map} styleURL="mapbox://styles/mapbox/dark-v11">
        <MapboxGL.Camera
          centerCoordinate={cameraCenter}
          zoomLevel={13}
          animationMode="flyTo"
          animationDuration={1000}
        />
        {filteredNodes.map((node) => (
          <MapboxGL.PointAnnotation
            key={node.id}
            id={node.id}
            coordinate={[node.lng, node.lat]}
            onSelected={() => handleNodePress(node)}
          >
            <View style={[styles.marker, { opacity: (pulseScores[node.id] ?? 0) > 0 ? 1 : 0.5 }]}>
              <View style={styles.markerDot} />
            </View>
          </MapboxGL.PointAnnotation>
        ))}
      </MapboxGL.MapView>

      <View style={styles.filterOverlay}>
        <CategoryFilterBar onFilter={setCategoryFilter} />
      </View>

      {!onboarding.hintSeen && (
        <View style={styles.hintOverlay}>
          <View style={styles.hintBox}>
            <Text style={styles.hintText}>{t('map.tapHint')}</Text>
            <TouchableOpacity onPress={() => markHintSeen('hintSeen')}>
              <Text style={styles.hintDismiss}>✕</Text>
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
  filterOverlay: {
    position: 'absolute',
    top: 50,
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
  marker: { width: 24, height: 24, alignItems: 'center', justifyContent: 'center' },
  markerDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: colors.accent,
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
