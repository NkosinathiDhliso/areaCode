import { useEffect } from 'react'

import { getSocket } from '../lib/socket'
import { useMapStore } from '../stores/mapStore'
import type { Node, NodeCategory, ClaimStatus } from '../types'

interface NodeCreatedPayload {
  id: string
  name: string
  slug: string
  category: string
  lat: number
  lng: number
  claimStatus?: string
  nodeColour?: string
  isVerified?: boolean
}

/**
 * Listens for `node:created` socket events and inserts the new node into the
 * map store so it appears on the map in real time for every connected viewer.
 */
export function useNodeCreated(token?: string, opts?: { citySlug?: string }) {
  const addNode = useMapStore((s) => s.addNode)

  useEffect(() => {
    const socket = getSocket(token, opts?.citySlug ? { citySlug: opts.citySlug } : undefined)

    const handler = (payload: NodeCreatedPayload) => {
      const node: Node = {
        id: payload.id,
        name: payload.name,
        slug: payload.slug,
        category: payload.category as NodeCategory,
        lat: payload.lat,
        lng: payload.lng,
        cityId: '',
        businessId: null,
        submittedBy: null,
        claimStatus: (payload.claimStatus as ClaimStatus) ?? 'unclaimed',
        claimCipcStatus: null,
        nodeColour: payload.nodeColour ?? 'default',
        nodeIcon: null,
        qrCheckinEnabled: false,
        isVerified: payload.isVerified ?? false,
        isActive: true,
        createdAt: new Date().toISOString(),
      }
      addNode(node)
    }

    socket.on('node:created', handler)
    return () => {
      socket.off('node:created', handler)
    }
  }, [token, opts?.citySlug, addNode])
}
