import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '@area-code/shared/lib/api'
import type { PersonalityArchetype, PersonalityDimension } from '@area-code/shared/types'
import { PERSONALITY_DIMENSIONS } from '@area-code/shared/constants/genre-weights'
import { ArchetypeTestTool } from './ArchetypeTestTool'

const ARCHETYPE_ICONS = [
  {
    id: 'compass',
    label: 'Compass',
    svg: 'M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z',
  },
  { id: 'music', label: 'Music', svg: 'M9 18V5l12-2v13' },
  {
    id: 'flame',
    label: 'Flame',
    svg: 'M8.5 14.5A2.5 2.5 0 0011 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 11-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 002.5 2.5z',
  },
  {
    id: 'globe',
    label: 'Globe',
    svg: 'M12 2a10 10 0 100 20A10 10 0 0012 2zM2 12h20M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z',
  },
  { id: 'leaf', label: 'Leaf', svg: 'M17 8C8 10 5.9 16.17 3.82 19.93A2 2 0 006 22l1-1c3-3 8-8 13-10-5 2-8 7-10 12' },
  { id: 'crown', label: 'Crown', svg: 'M2 20h20M5 20V10l7-7 7 7v10' },
  { id: 'diamond', label: 'Diamond', svg: 'M2.7 10.3l9.3-8.6 9.3 8.6-9.3 11.4-9.3-11.4z' },
  { id: 'moon', label: 'Moon', svg: 'M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z' },
  { id: 'zap', label: 'Energy', svg: 'M13 2L3 14h9l-1 8 10-12h-9l1-8z' },
  { id: 'eye', label: 'Eye', svg: 'M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z M12 12m-3 0a3 3 0 106 0 3 3 0 00-6 0' },
  {
    id: 'sun',
    label: 'Sun',
    svg: 'M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42M12 17a5 5 0 100-10 5 5 0 000 10z',
  },
  {
    id: 'heart',
    label: 'Heart',
    svg: 'M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z',
  },
]

const DIMENSION_LABELS: Record<string, string> = {
  energy: 'Energy',
  cultural_rootedness: 'Cultural Rootedness',
  sophistication: 'Sophistication',
  edge: 'Edge',
  spirituality: 'Spirituality',
}

const EMPTY_FORM = {
  name: '',
  iconId: 'compass',
  description: '',
  priority: 1,
  energy: '',
  cultural_rootedness: '',
  sophistication: '',
  edge: '',
  spirituality: '',
}

export function ArchetypeManagement() {
  const { t } = useTranslation()
  const [archetypes, setArchetypes] = useState<PersonalityArchetype[]>([])
  const [editing, setEditing] = useState<string | null>(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [showAdd, setShowAdd] = useState(false)
  const [loadError, setLoadError] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  useEffect(() => {
    api
      .get<PersonalityArchetype[]>('/v1/admin/archetypes')
      .then(setArchetypes)
      .catch(() => setLoadError(true))
  }, [])

  function startEdit(a: PersonalityArchetype) {
    setEditing(a.id)
    setShowAdd(false)
    setForm({
      name: a.name,
      iconId: a.iconId,
      description: a.description,
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
    setSaveError(null)
    const payload = {
      name: form.name,
      iconId: form.iconId,
      description: form.description,
      priority: form.priority,
      dimensionThresholds: buildThresholds(),
      isActive: true,
    }
    try {
      if (editing) {
        await api.patch(`/v1/admin/archetypes/${editing}`, payload)
      } else {
        await api.post('/v1/admin/archetypes', payload)
      }
      const updated = await api.get<PersonalityArchetype[]>('/v1/admin/archetypes')
      setArchetypes(updated)
      setEditing(null)
      setShowAdd(false)
    } catch (err: unknown) {
      const e = err as { message?: string }
      setSaveError(e.message ?? 'Failed to save archetype.')
    }
  }

  async function toggleActive(a: PersonalityArchetype) {
    try {
      await api.patch(`/v1/admin/archetypes/${a.id}`, { isActive: !a.isActive })
      setArchetypes((prev) => prev.map((x) => (x.id === a.id ? { ...x, isActive: !x.isActive } : x)))
    } catch {
      setSaveError('Failed to update archetype status.')
    }
  }

  return (
    <div className="p-5 flex flex-col gap-4">
      <div className="flex flex-row items-center justify-between">
        <h2 className="text-[var(--text-primary)] font-bold text-xl font-[Syne]">{t('admin.archetypes.title')}</h2>
        <button onClick={startAdd} className="bg-[var(--accent)] text-white rounded-xl px-4 py-2 text-sm">
          {t('admin.archetypes.add')}
        </button>
      </div>

      {loadError && (
        <div className="bg-[var(--danger)]/10 border border-[var(--danger)] rounded-xl p-3 text-[var(--danger)] text-sm">
          Failed to load archetypes. Please refresh.
        </div>
      )}
      {saveError && (
        <div className="bg-[var(--danger)]/10 border border-[var(--danger)] rounded-xl p-3 text-[var(--danger)] text-sm">
          {saveError}
        </div>
      )}

      {/* List */}
      <div className="flex flex-col gap-2">
        {archetypes.map((a) => (
          <div
            key={a.id}
            className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-2xl px-4 py-3 flex flex-row items-center gap-3"
          >
            <span className="text-[var(--text-muted)] text-sm w-8">{a.priority}</span>
            <span className="text-[var(--text-muted)]">
              {(() => {
                const ic = ARCHETYPE_ICONS.find((i) => i.id === a.iconId)
                return ic ? (
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.75"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d={ic.svg} />
                  </svg>
                ) : (
                  <span className="text-xs">{a.iconId}</span>
                )
              })()}
            </span>
            <span className="text-[var(--text-primary)] text-sm font-medium flex-1">{a.name}</span>
            <button
              onClick={() => void toggleActive(a)}
              className={`text-xs px-2 py-1 rounded-lg ${a.isActive ? 'bg-green-900/30 text-green-400' : 'bg-red-900/30 text-red-400'}`}
            >
              {a.isActive ? t('admin.archetypes.active') : 'Inactive'}
            </button>
            <button onClick={() => startEdit(a)} className="text-[var(--accent)] text-xs">
              {t('admin.archetypes.edit')}
            </button>
          </div>
        ))}
      </div>

      {/* Add/Edit form */}
      {(showAdd || editing) && (
        <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-2xl p-4 flex flex-col gap-3">
          <h3 className="text-[var(--text-primary)] text-sm font-medium">
            {editing ? t('admin.archetypes.edit') : t('admin.archetypes.add')}
          </h3>
          <input
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder={t('admin.archetypes.name')}
            className="bg-[var(--bg-raised)] border border-[var(--border)] rounded-xl px-3 py-2 text-sm text-[var(--text-primary)]"
          />
          <div className="flex flex-col gap-1">
            <p className="text-[var(--text-secondary)] text-xs font-medium">Icon</p>
            <div className="flex flex-wrap gap-2">
              {ARCHETYPE_ICONS.map((ic) => (
                <button
                  key={ic.id}
                  type="button"
                  title={ic.label}
                  onClick={() => setForm({ ...form, iconId: ic.id })}
                  className={`w-9 h-9 rounded-xl border flex items-center justify-center transition-colors ${
                    form.iconId === ic.id
                      ? 'border-[var(--accent)] bg-[var(--accent)]/15 text-[var(--accent)]'
                      : 'border-[var(--border)] text-[var(--text-muted)] hover:border-[var(--accent)]/50'
                  }`}
                >
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.75"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d={ic.svg} />
                  </svg>
                </button>
              ))}
            </div>
            <p className="text-[var(--text-muted)] text-xs">
              Selected: <code className="bg-[var(--bg-raised)] px-1 rounded">{form.iconId}</code>
            </p>
          </div>
          <textarea
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            placeholder={t('admin.archetypes.description')}
            className="bg-[var(--bg-raised)] border border-[var(--border)] rounded-xl px-3 py-2 text-sm text-[var(--text-primary)] resize-none"
            rows={2}
          />
          <input
            type="number"
            value={form.priority}
            onChange={(e) => setForm({ ...form, priority: Number(e.target.value) })}
            placeholder={t('admin.archetypes.priority')}
            className="bg-[var(--bg-raised)] border border-[var(--border)] rounded-xl px-3 py-2 text-sm text-[var(--text-primary)]"
          />
          <div className="flex flex-col gap-2">
            <p className="text-[var(--text-secondary)] text-xs font-medium">
              Dimension thresholds{' '}
              <span className="text-[var(--text-muted)] font-normal">(0.0 – 1.0, leave blank to ignore)</span>
            </p>
            <div className="grid grid-cols-2 gap-2">
              {PERSONALITY_DIMENSIONS.map((d) => (
                <div key={d} className="flex flex-col gap-0.5">
                  <label className="text-[var(--text-muted)] text-xs">{DIMENSION_LABELS[d] ?? d}</label>
                  <input
                    type="number"
                    step="0.05"
                    min="0"
                    max="1"
                    value={form[d]}
                    onChange={(e) => setForm({ ...form, [d]: e.target.value })}
                    placeholder="0.0"
                    className="bg-[var(--bg-raised)] border border-[var(--border)] rounded-xl px-3 py-2 text-sm text-[var(--text-primary)] w-full"
                  />
                </div>
              ))}
            </div>
          </div>
          <div className="flex flex-row gap-2">
            <button
              onClick={() => {
                setEditing(null)
                setShowAdd(false)
              }}
              className="flex-1 border border-[var(--border)] rounded-xl py-2 text-sm text-[var(--text-secondary)]"
            >
              Cancel
            </button>
            <button
              onClick={() => void handleSave()}
              className="flex-1 bg-[var(--accent)] text-white rounded-xl py-2 text-sm"
            >
              Save
            </button>
          </div>
        </div>
      )}

      <ArchetypeTestTool />
    </div>
  )
}
