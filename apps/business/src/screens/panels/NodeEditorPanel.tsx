import { useEffect, useState } from 'react'

import { api } from '@area-code/shared/lib/api'
import type { Node } from '@area-code/shared/types'
import { useBusinessStore } from '@area-code/shared/stores/businessStore'

export function NodeEditorPanel() {
  const { nodes, setNodes } = useBusinessStore()
  const [selected, setSelected] = useState<Node | null>(nodes[0] ?? null)
  const [name, setName] = useState(selected?.name ?? '')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    async function fetch() {
      try {
        const res = await api.get<{ items: Node[] }>('/v1/business/me/nodes')
        setNodes(res.items)
        if (res.items[0]) {
          setSelected(res.items[0])
          setName(res.items[0].name)
        }
      } catch {
        // Fail silently
      }
    }
    if (nodes.length === 0) fetch()
  }, [nodes.length, setNodes])

  async function handleSave() {
    if (!selected) return
    setSaving(true)
    try {
      await api.put(`/v1/nodes/${selected.id}`, { name })
    } catch {
      // Fail silently
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="p-5 flex flex-col gap-4">
      <h2 className="text-[var(--text-primary)] font-bold text-xl font-[Syne]">Node</h2>

      {selected ? (
        <div className="flex flex-col gap-4">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Node name"
            className="bg-[var(--bg-raised)] border border-[var(--border)] text-[var(--text-primary)] rounded-xl px-4 py-3 text-sm focus:border-[var(--accent)] focus:outline-none"
          />

          <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-2xl p-4">
            <span className="text-[var(--text-secondary)] text-xs">Category: {selected.category}</span>
            <p className="text-[var(--text-muted)] text-xs mt-1">
              {selected.lat.toFixed(4)}, {selected.lng.toFixed(4)}
            </p>
          </div>

          <button
            onClick={handleSave}
            disabled={saving}
            className="bg-[var(--accent)] text-white font-semibold rounded-xl py-3 text-sm disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      ) : (
        <p className="text-[var(--text-muted)]">No nodes yet</p>
      )}
    </div>
  )
}
