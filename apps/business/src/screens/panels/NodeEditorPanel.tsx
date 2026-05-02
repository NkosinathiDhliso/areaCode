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
      <h2 className="text-[var(--text-primary)] font-bold text-xl font-[Syne]">Node</h2>

      {nodes.length === 0 ? (
        <p className="text-[var(--text-muted)] text-sm">
          No nodes yet. Nodes are created when you claim a venue on the map.
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
    </div>
  )
}
