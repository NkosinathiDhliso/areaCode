import { useEffect, useState } from 'react'

import { api } from '@area-code/shared/lib/api'
import type { Node } from '@area-code/shared/types'
import { useBusinessStore } from '@area-code/shared/stores/businessStore'

export function NodeEditorPanel() {
  const { nodes, setNodes } = useBusinessStore()
  const [selected, setSelected] = useState<Node | null>(null)
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saveSuccess, setSaveSuccess] = useState(false)
  const [loading, setLoading] = useState(nodes.length === 0)
  const [addVenueOpen, setAddVenueOpen] = useState(false)
  const [addVenueName, setAddVenueName] = useState('')
  const [addVenueAddress, setAddVenueAddress] = useState('')
  const [addVenueCategory, setAddVenueCategory] = useState<'food' | 'coffee' | 'nightlife' | 'retail' | 'fitness' | 'arts'>('food')
  const [addVenueLoading, setAddVenueLoading] = useState(false)
  const [addVenueError, setAddVenueError] = useState('')

  useEffect(() => {
    async function fetchNodes() {
      setLoading(true)
      try {
        const res = await api.get<{ items: Node[] }>('/v1/business/me/nodes')
        const items = res.items ?? []
        setNodes(items)
        if (items[0]) {
          setSelected(items[0])
          setName(items[0].name)
        }
      } catch {
        // Fail silently
      } finally {
        setLoading(false)
      }
    }
    if (nodes.length === 0) {
      void fetchNodes()
    } else {
      const first = nodes[0] ?? null
      setSelected(first)
      setName(first?.name ?? '')
      setLoading(false)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function handleSelectNode(id: string) {
    const node = nodes.find((n) => n.id === id) ?? null
    if (node) {
      setSelected(node)
      setName(node.name)
      setSaveError(null)
      setSaveSuccess(false)
    }
  }

  async function handleAddVenue() {
    if (!addVenueName.trim() || !addVenueAddress.trim()) return
    setAddVenueLoading(true)
    setAddVenueError('')
    try {
      const res = await api.post<{ id: string; name: string }>('/v1/nodes/business-create', {
        name: addVenueName.trim(),
        category: addVenueCategory,
        address: addVenueAddress.trim(),
      })
      setAddVenueOpen(false)
      setAddVenueName('')
      setAddVenueAddress('')
      setAddVenueCategory('food')
      // Refresh nodes list
      const nodesRes = await api.get<{ items: Node[] }>('/v1/business/me/nodes')
      const items = nodesRes.items ?? []
      setNodes(items)
      if (items[0]) {
        setSelected(items[0])
        setName(items[0].name)
      }
    } catch (err: any) {
      setAddVenueError(err?.message || 'Failed to add venue')
    } finally {
      setAddVenueLoading(false)
    }
  }

  async function handleSave() {
    if (!selected) return
    setSaving(true)
    setSaveError(null)
    setSaveSuccess(false)
    try {
      await api.put(`/v1/nodes/${selected.id}`, { name: name.trim() })
      setNodes(nodes.map((n) => n.id === selected.id ? { ...n, name: name.trim() } : n))
      setSaveSuccess(true)
      setTimeout(() => setSaveSuccess(false), 3000)
    } catch {
      setSaveError('Failed to save changes. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="p-5 flex items-center justify-center py-12">
        <span className="text-[var(--text-muted)] text-sm">Loading...</span>
      </div>
    )
  }

  return (
    <div className="p-5 flex flex-col gap-4">
      <div className="flex flex-row items-center justify-between">
        <h2 className="text-[var(--text-primary)] font-bold text-xl font-[Syne]">Node</h2>
        <button
          onClick={() => setAddVenueOpen(true)}
          className="bg-[var(--accent)] text-white font-semibold rounded-xl px-4 py-2 text-sm"
        >
          + Add Venue
        </button>
      </div>

      {nodes.length === 0 ? (
        <p className="text-[var(--text-muted)] text-sm">
          No nodes yet. Add your venue by entering your address below.
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          {nodes.length > 1 && (
            <select
              value={selected?.id ?? ''}
              onChange={(e) => handleSelectNode(e.target.value)}
              className="bg-[var(--bg-raised)] border border-[var(--border)] text-[var(--text-primary)] rounded-xl px-4 py-3 text-sm focus:border-[var(--accent)] focus:outline-none appearance-none"
            >
              {nodes.map((n) => (
                <option key={n.id} value={n.id}>{n.name}</option>
              ))}
            </select>
          )}

          {selected && (
            <>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Node name"
                className="bg-[var(--bg-raised)] border border-[var(--border)] text-[var(--text-primary)] rounded-xl px-4 py-3 text-sm focus:border-[var(--accent)] focus:outline-none"
              />

              <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-2xl p-4 flex flex-col gap-1">
                <span className="text-[var(--text-secondary)] text-xs">Category: <span className="capitalize">{selected.category}</span></span>
                <span className="text-[var(--text-muted)] text-xs">
                  {selected.lat.toFixed(4)}, {selected.lng.toFixed(4)}
                </span>
                {selected.claimStatus && (
                  <span className="text-[var(--text-muted)] text-xs capitalize">
                    Status: {selected.claimStatus.replace(/_/g, ' ')}
                  </span>
                )}
              </div>

              <button
                onClick={() => void handleSave()}
                disabled={saving || !name.trim()}
                className="bg-[var(--accent)] text-white font-semibold rounded-xl py-3 text-sm disabled:opacity-50"
              >
                {saving ? 'Saving...' : 'Save Changes'}
              </button>
              {saveSuccess && <p className="text-[var(--success)] text-xs text-center">Saved successfully.</p>}
              {saveError && <p className="text-[var(--danger)] text-xs">{saveError}</p>}
            </>
          )}
        </div>
      )}

      {/* Add Venue Modal */}
      {addVenueOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-5">
          <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-2xl p-6 max-w-sm w-full">
            <h3 className="text-[var(--text-primary)] font-bold text-lg mb-2 font-[Syne]">Add Your Venue</h3>
            <p className="text-[var(--text-secondary)] text-sm mb-4">
              Enter your venue details to add it to the map.
            </p>
            {addVenueError && <p className="text-[var(--danger)] text-sm mb-4">{addVenueError}</p>}
            <div className="flex flex-col gap-3 mb-4">
              <label className="text-[var(--text-primary)] text-xs font-medium">Venue Name</label>
              <input
                type="text"
                value={addVenueName}
                onChange={(e) => setAddVenueName(e.target.value)}
                placeholder="e.g. Father Coffee"
                className="w-full bg-[var(--bg-raised)] border border-[var(--border)] text-[var(--text-primary)] rounded-xl px-4 py-3 text-sm placeholder:text-[var(--text-muted)] focus:border-[var(--accent)] focus:outline-none"
              />
              <label className="text-[var(--text-primary)] text-xs font-medium">Address</label>
              <input
                type="text"
                value={addVenueAddress}
                onChange={(e) => setAddVenueAddress(e.target.value)}
                placeholder="e.g. 73 Juta Street, Braamfontein, Johannesburg"
                className="w-full bg-[var(--bg-raised)] border border-[var(--border)] text-[var(--text-primary)] rounded-xl px-4 py-3 text-sm placeholder:text-[var(--text-muted)] focus:border-[var(--accent)] focus:outline-none"
              />
              <label className="text-[var(--text-primary)] text-xs font-medium">Category</label>
              <select
                value={addVenueCategory}
                onChange={(e) => setAddVenueCategory(e.target.value as any)}
                className="w-full bg-[var(--bg-raised)] border border-[var(--border)] text-[var(--text-primary)] rounded-xl px-4 py-3 text-sm focus:border-[var(--accent)] focus:outline-none"
              >
                <option value="food">Food</option>
                <option value="coffee">Coffee</option>
                <option value="nightlife">Nightlife</option>
                <option value="retail">Retail</option>
                <option value="fitness">Fitness</option>
                <option value="arts">Arts</option>
              </select>
            </div>
            <div className="flex flex-row gap-3">
              <button
                onClick={() => setAddVenueOpen(false)}
                className="flex-1 border border-[var(--border)] text-[var(--text-primary)] rounded-xl py-2.5 text-sm"
              >
                Cancel
              </button>
              <button
                onClick={() => void handleAddVenue()}
                disabled={addVenueLoading || !addVenueName.trim() || !addVenueAddress.trim()}
                className="flex-1 bg-[var(--accent)] text-white rounded-xl py-2.5 text-sm font-medium disabled:opacity-50"
              >
                {addVenueLoading ? 'Adding...' : 'Add Venue'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
