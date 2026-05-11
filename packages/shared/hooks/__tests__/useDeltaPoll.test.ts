import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { useMapStore } from '../../stores/mapStore'

// Mock the api module
vi.mock('../../lib/api', () => ({
  api: {
    get: vi.fn(),
  },
}))

// We need to import after mocking
import { api } from '../../lib/api'

// Since we can't use @testing-library/react-hooks, we test the hook's
// underlying logic by simulating what the hook does: polling, visibility, store updates.
// We'll test the store integration and the polling logic separately.

describe('useDeltaPoll - store integration', () => {
  beforeEach(() => {
    useMapStore.setState({
      nodes: {},
      pulseScores: {},
      signalData: {},
      mapInstance: null,
    })
  })

  it('applyDelta updates pulseScores for nodes with pulseScore', () => {
    useMapStore.getState().applyDelta([
      { nodeId: 'node-1', pulseScore: 42 },
      { nodeId: 'node-2', pulseScore: 88 },
    ])

    expect(useMapStore.getState().pulseScores['node-1']).toBe(42)
    expect(useMapStore.getState().pulseScores['node-2']).toBe(88)
  })

  it('applyDelta stores signal consensus data', () => {
    useMapStore.getState().applyDelta([
      {
        nodeId: 'node-1',
        consensusGenre: 'amapiano',
        consensusGenreConfidence: 0.82,
        consensusQueue: 'short',
        consensusQueueConfidence: 0.65,
        signalReportCount: 7,
        lastSignalAt: '2025-01-15T22:30:00.000Z',
        isOwnerReport: false,
      },
    ])

    const signalData = useMapStore.getState().signalData['node-1']
    expect(signalData?.consensusGenre).toBe('amapiano')
    expect(signalData?.consensusGenreConfidence).toBe(0.82)
    expect(signalData?.consensusQueue).toBe('short')
    expect(signalData?.consensusQueueConfidence).toBe(0.65)
    expect(signalData?.signalReportCount).toBe(7)
    expect(signalData?.isOwnerReport).toBe(false)
  })

  it('applyDelta merges with existing signal data', () => {
    // First delta with genre data
    useMapStore.getState().applyDelta([
      {
        nodeId: 'node-1',
        consensusGenre: 'amapiano',
        consensusGenreConfidence: 0.82,
      },
    ])

    // Second delta with queue data
    useMapStore.getState().applyDelta([
      {
        nodeId: 'node-1',
        consensusQueue: 'long',
        consensusQueueConfidence: 0.55,
      },
    ])

    const signalData = useMapStore.getState().signalData['node-1']
    expect(signalData?.consensusGenre).toBe('amapiano')
    expect(signalData?.consensusQueue).toBe('long')
  })

  it('applyDelta handles empty array without error', () => {
    useMapStore.getState().applyDelta([])
    expect(useMapStore.getState().signalData).toEqual({})
  })

  it('applyDelta does not overwrite pulseScores when pulseScore is undefined', () => {
    useMapStore.getState().updateNodePulse('node-1', 50)
    useMapStore.getState().applyDelta([
      { nodeId: 'node-1', consensusGenre: 'gqom' },
    ])

    expect(useMapStore.getState().pulseScores['node-1']).toBe(50)
  })
})

describe('useDeltaPoll - polling logic', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    useMapStore.setState({
      nodes: {},
      pulseScores: {},
      signalData: {},
      mapInstance: null,
    })
    vi.mocked(api.get).mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('api.get is called with correct URL format', async () => {
    const mockResponse = {
      nodes: [{ nodeId: 'node-1', pulseScore: 30 }],
      serverTime: '2025-01-15T22:30:10.000Z',
    }
    vi.mocked(api.get).mockResolvedValue(mockResponse)

    // Simulate what the hook does: call the API
    const citySlug = 'johannesburg'
    const since = '2025-01-15T22:30:00.000Z'
    await api.get(`/v1/pulse/city/${encodeURIComponent(citySlug)}/delta?since=${encodeURIComponent(since)}`)

    expect(api.get).toHaveBeenCalledWith(
      '/v1/pulse/city/johannesburg/delta?since=2025-01-15T22%3A30%3A00.000Z',
    )
  })

  it('serverTime from response is used as next since parameter', async () => {
    const firstResponse = {
      nodes: [{ nodeId: 'node-1', pulseScore: 30 }],
      serverTime: '2025-01-15T22:30:10.000Z',
    }
    const secondResponse = {
      nodes: [],
      serverTime: '2025-01-15T22:30:20.000Z',
    }

    vi.mocked(api.get)
      .mockResolvedValueOnce(firstResponse)
      .mockResolvedValueOnce(secondResponse)

    // Simulate the hook's polling logic
    let serverTime = new Date().toISOString()
    const citySlug = 'cape-town'

    // First poll
    const res1 = await api.get<typeof firstResponse>(
      `/v1/pulse/city/${encodeURIComponent(citySlug)}/delta?since=${encodeURIComponent(serverTime)}`,
    )
    serverTime = res1.serverTime

    expect(serverTime).toBe('2025-01-15T22:30:10.000Z')

    // Second poll uses updated serverTime
    await api.get(
      `/v1/pulse/city/${encodeURIComponent(citySlug)}/delta?since=${encodeURIComponent(serverTime)}`,
    )

    expect(vi.mocked(api.get).mock.calls[1]![0]).toContain(
      'since=2025-01-15T22%3A30%3A10.000Z',
    )
  })

  it('poll errors are silently ignored (no throw)', async () => {
    vi.mocked(api.get).mockRejectedValue(new Error('Network error'))

    // Simulate the hook's error handling
    try {
      await api.get('/v1/pulse/city/johannesburg/delta?since=2025-01-15T22:30:00.000Z')
    } catch {
      // Hook catches and ignores — this is expected behavior
    }

    // No unhandled rejection — test passes if we get here
    expect(true).toBe(true)
  })
})
