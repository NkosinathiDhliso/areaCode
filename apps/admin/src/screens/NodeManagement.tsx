import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { api } from '@area-code/shared/lib/api'
import { Spinner } from '@area-code/shared/components/Spinner'

interface NodeItem {
  nodeId: string
  name: string
  category?: string
  businessId?: string
  cityId?: string
  isActive?: boolean
  lat?: number
  lng?: number
}

export function NodeManagement() {
  const { t } = useTranslation()
  const [search, setSearch] = useState('')
  const [nodes, setNodes] = useState<NodeItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [editingNode, setEditingNode] = useState<NodeItem | null>(null)
  const [editName, setEditName] = useState('')
  const [editCategory, setEditCategory] = useState('')
  const [actionLoading, setActionLoading] = useState(false)

  async function handleSearch() {
    setLoading(true)
    setError(null)
    try {
      const res = await api.get<{ items: NodeItem[] }>(`/v1/admin/nodes?q=${encodeURIComponent(search)}`)
      setNodes(res.items)
    } catch {
      setError('Search failed. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  async function handleAction(nodeId: string, action: string, body?: Record<string, unknown>) {
    setActionLoading(true)
    try {
      await api.post(`/v1/admin/nodes/${nodeId}/${action}`, body)
      setEditingNode(null)
      void handleSearch()
    } catch {
      setError('Action failed. Please try again.')
    } finally {
      setActionLoading(false)
    }
  }

  function handleEdit(node: NodeItem) {
    setEditingNode(node)
    setEditName(node.name ?? '')
    setEditCategory(node.category ?? '')
  }

  function handleSaveEdit() {
    if (!editingNode) return
    void handleAction(editingNode.nodeId, 'update', { name: editName, category: editCategory })
  }

  return (
    <div className="p-5">
      <h2 className="text-[var(--text-primary)] font-bold text-lg font-[Syne] mb-4">
        {t('admin.nodes.title', 'Node Management')}
      </h2>

      <div className="flex gap-2 mb-4">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
          placeholder={t('admin.nodes.searchPlaceholder', 'Search nodes by name...')}
          className="flex-1 px-4 py-2.5 rounded-xl bg-[var(--bg-surface)] border border-[var(--border)] text-[var(--text-primary)] text-sm placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)]"
        />
        <button
          onClick={handleSearch}
          disabled={loading}
          className="px-4 py-2.5 rounded-xl bg-[var(--accent)] text-white text-sm font-medium"
        >
          {loading ? (
            <Spinner size="sm" className="border-white border-t-transparent" />
          ) : (
            t('admin.nodes.search', 'Search')
          )}
        </button>
      </div>

      {error && <p className="text-[var(--danger)] text-sm mb-3">{error}</p>}

      {!loading && nodes.length === 0 && (
        <p className="text-[var(--text-muted)] text-sm text-center py-8">
          {t('admin.nodes.noResults', 'No nodes found.')}
        </p>
      )}

      <div className="flex flex-col gap-2">
        {nodes.map((node) => (
          <div
            key={node.nodeId}
            className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-xl p-4 flex flex-col gap-2"
          >
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[var(--text-primary)] text-sm font-medium">{node.name}</p>
                <p className="text-[var(--text-muted)] text-xs">
                  {node.category ?? 'uncategorized'} ·{' '}
                  {node.businessId ? `biz: ${node.businessId.slice(0, 8)}…` : 'no business'}
                </p>
              </div>
              <span
                className={`text-xs px-2 py-0.5 rounded-full ${node.isActive !== false ? 'bg-green-500/10 text-green-500' : 'bg-red-500/10 text-red-500'}`}
              >
                {node.isActive !== false ? 'Active' : 'Inactive'}
              </span>
            </div>
            <div className="flex gap-2 pt-1">
              <button onClick={() => handleEdit(node)} className="text-xs text-[var(--accent)] font-medium">
                {t('admin.nodes.edit', 'Edit')}
              </button>
              {node.isActive !== false ? (
                <button
                  onClick={() => handleAction(node.nodeId, 'deactivate')}
                  disabled={actionLoading}
                  className="text-xs text-[var(--danger)] font-medium"
                >
                  {t('admin.nodes.deactivate', 'Deactivate')}
                </button>
              ) : (
                <button
                  onClick={() => handleAction(node.nodeId, 'activate')}
                  disabled={actionLoading}
                  className="text-xs text-green-500 font-medium"
                >
                  {t('admin.nodes.activate', 'Activate')}
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Edit modal */}
      {editingNode && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-5">
          <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-2xl p-6 max-w-sm w-full">
            <h3 className="text-[var(--text-primary)] font-bold text-lg mb-4 font-[Syne]">
              {t('admin.nodes.editTitle', 'Edit Node')}
            </h3>
            <div className="flex flex-col gap-3 mb-4">
              <div>
                <label className="text-[var(--text-secondary)] text-xs mb-1 block">
                  {t('admin.nodes.name', 'Name')}
                </label>
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-[var(--bg-raised)] border border-[var(--border)] text-[var(--text-primary)] text-sm focus:outline-none focus:border-[var(--accent)]"
                />
              </div>
              <div>
                <label className="text-[var(--text-secondary)] text-xs mb-1 block">
                  {t('admin.nodes.category', 'Category')}
                </label>
                <input
                  type="text"
                  value={editCategory}
                  onChange={(e) => setEditCategory(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-[var(--bg-raised)] border border-[var(--border)] text-[var(--text-primary)] text-sm focus:outline-none focus:border-[var(--accent)]"
                />
              </div>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setEditingNode(null)}
                className="flex-1 border border-[var(--border)] text-[var(--text-primary)] rounded-xl py-2.5 text-sm"
              >
                {t('common.cancel', 'Cancel')}
              </button>
              <button
                onClick={handleSaveEdit}
                disabled={actionLoading}
                className="flex-1 bg-[var(--accent)] text-white rounded-xl py-2.5 text-sm font-medium flex items-center justify-center"
              >
                {actionLoading ? (
                  <Spinner size="sm" className="border-white border-t-transparent" />
                ) : (
                  t('common.save', 'Save')
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
