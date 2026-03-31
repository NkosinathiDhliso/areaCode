import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '@area-code/shared/lib/api'
import type { PersonalityArchetype, PersonalityDimension } from '@area-code/shared/types'
import { PERSONALITY_DIMENSIONS } from '@area-code/shared/constants/genre-weights'
import { ArchetypeTestTool } from './ArchetypeTestTool'

const EMPTY_FORM = {
  name: '', iconId: '', description: '', priority: 1,
  energy: '', cultural_rootedness: '', sophistication: '', edge: '', spirituality: '',
}

export function ArchetypeManagement() {
  const { t } = useTranslation()
  const [archetypes, setArchetypes] = useState<PersonalityArchetype[]>([])
  const [editing, setEditing] = useState<string | null>(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [showAdd, setShowAdd] = useState(false)

  useEffect(() => {
    api.get<PersonalityArchetype[]>('/v1/admin/archetypes')
      .then(setArchetypes)
      .catch(() => {})
  }, [])

  function startEdit(a: PersonalityArchetype) {
    setEditing(a.id)
    setShowAdd(false)
    setForm({
      name: a.name, iconId: a.iconId, description: a.description,
      priority: a.priority,
      energy: String(a.dimensionThresholds.energy ?? ''),
      cultural_rootedness: String(a.dimensionThresholds.cultural_rootedness ?? ''),
      sophistication: String(a.dimensionThresholds.sophistication ?? ''),
      edge: String(a.dimensionThresholds.edge ?? ''),
      spirituality: String(a.dimensionThresholds.spirituality ?? ''),
    })
  }

  function startAdd() {
    setEditing(null)
    setShowAdd(true)
    setForm(EMPTY_FORM)
  }

  function buildThresholds(): Partial<Record<PersonalityDimension, number>> {
    const t: Partial<Record<PersonalityDimension, number>> = {}
    for (const d of PERSONALITY_DIMENSIONS) {
      const v = parseFloat(form[d])
      if (!isNaN(v) && v > 0) t[d] = v
    }
    return t
  }

  async function handleSave() {
    const payload = {
      name: form.name, iconId: form.iconId, description: form.description,
      priority: form.priority, dimensionThresholds: buildThresholds(), isActive: true,
    }
    if (editing) {
      await api.patch(`/v1/admin/archetypes/${editing}`, payload)
    } else {
      await api.post('/v1/admin/archetypes', payload)
    }
    const updated = await api.get<PersonalityArchetype[]>('/v1/admin/archetypes')
    setArchetypes(updated)
    setEditing(null)
    setShowAdd(false)
  }

  async function toggleActive(a: PersonalityArchetype) {
    await api.patch(`/v1/admin/archetypes/${a.id}`, { isActive: !a.isActive })
    setArchetypes((prev) => prev.map((x) => x.id === a.id ? { ...x, isActive: !x.isActive } : x))
  }

  return (
    <div className="p-5 flex flex-col gap-4">
      <div className="flex flex-row items-center justify-between">
        <h2 className="text-[var(--text-primary)] font-bold text-xl font-[Syne]">{t('admin.archetypes.title')}</h2>
        <button onClick={startAdd} className="bg-[var(--accent)] text-white rounded-xl px-4 py-2 text-sm">{t('admin.archetypes.add')}</button>
      </div>

      {/* List */}
      <div className="flex flex-col gap-2">
        {archetypes.map((a) => (
          <div key={a.id} className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-2xl px-4 py-3 flex flex-row items-center gap-3">
            <span className="text-[var(--text-muted)] text-sm w-8">{a.priority}</span>
            <span className="text-[var(--text-muted)] text-xs">{a.iconId}</span>
            <span className="text-[var(--text-primary)] text-sm font-medium flex-1">{a.name}</span>
            <button
              onClick={() => toggleActive(a)}
              className={`text-xs px-2 py-1 rounded-lg ${a.isActive ? 'bg-green-900/30 text-green-400' : 'bg-red-900/30 text-red-400'}`}
            >
              {a.isActive ? t('admin.archetypes.active') : 'Inactive'}
            </button>
            <button onClick={() => startEdit(a)} className="text-[var(--accent)] text-xs">{t('admin.archetypes.edit')}</button>
          </div>
        ))}
      </div>

      {/* Add/Edit form */}
      {(showAdd || editing) && (
        <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-2xl p-4 flex flex-col gap-3">
          <h3 className="text-[var(--text-primary)] text-sm font-medium">
            {editing ? t('admin.archetypes.edit') : t('admin.archetypes.add')}
          </h3>
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder={t('admin.archetypes.name')}
            className="bg-[var(--bg-raised)] border border-[var(--border)] rounded-xl px-3 py-2 text-sm text-[var(--text-primary)]" />
          <input value={form.iconId} onChange={(e) => setForm({ ...form, iconId: e.target.value })}
            placeholder={t('admin.archetypes.iconId')}
            className="bg-[var(--bg-raised)] border border-[var(--border)] rounded-xl px-3 py-2 text-sm text-[var(--text-primary)]" />
          <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}
            placeholder={t('admin.archetypes.description')}
            className="bg-[var(--bg-raised)] border border-[var(--border)] rounded-xl px-3 py-2 text-sm text-[var(--text-primary)] resize-none" rows={2} />
          <input type="number" value={form.priority} onChange={(e) => setForm({ ...form, priority: Number(e.target.value) })}
            placeholder={t('admin.archetypes.priority')}
            className="bg-[var(--bg-raised)] border border-[var(--border)] rounded-xl px-3 py-2 text-sm text-[var(--text-primary)]" />
          <p className="text-[var(--text-secondary)] text-xs">{t('admin.archetypes.thresholds')}</p>
          <div className="flex flex-row flex-wrap gap-2">
            {PERSONALITY_DIMENSIONS.map((d) => (
              <input key={d} type="number" step="0.1" min="0" max="1"
                value={form[d]} onChange={(e) => setForm({ ...form, [d]: e.target.value })}
                placeholder={d}
                className="bg-[var(--bg-raised)] border border-[var(--border)] rounded-xl px-3 py-2 text-sm text-[var(--text-primary)] w-28" />
            ))}
          </div>
          <div className="flex flex-row gap-2">
            <button onClick={() => { setEditing(null); setShowAdd(false) }}
              className="flex-1 border border-[var(--border)] rounded-xl py-2 text-sm text-[var(--text-secondary)]">Cancel</button>
            <button onClick={handleSave}
              className="flex-1 bg-[var(--accent)] text-white rounded-xl py-2 text-sm">Save</button>
          </div>
        </div>
      )}

      <ArchetypeTestTool />
    </div>
  )
}
