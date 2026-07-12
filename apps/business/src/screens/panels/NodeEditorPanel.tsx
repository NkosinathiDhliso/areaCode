import { MediaImage } from '@area-code/shared/components/MediaImage'
import { PhotoUnavailable } from '@area-code/shared/components/PhotoUnavailable'
import { api } from '@area-code/shared/lib/api'
import {
  compressImageFile,
  MAX_HEADER_IMAGE_BYTES,
  MAX_HEADER_IMAGE_LABEL,
} from '@area-code/shared/lib/imageCompression'
import { mediaUrl } from '@area-code/shared/lib/mediaUrl'
import { useBusinessStore } from '@area-code/shared/stores/businessStore'
import type { Node } from '@area-code/shared/types'
import { useEffect, useRef, useState } from 'react'

import { MapboxAddressInput } from '../../components/MapboxAddressInput'

export function NodeEditorPanel() {
  const { nodes, setNodes } = useBusinessStore()
  const [selected, setSelected] = useState<Node | null>(null)
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saveSuccess, setSaveSuccess] = useState(false)
  const [loading, setLoading] = useState(nodes.length === 0)
  const [loadError, setLoadError] = useState(false)
  const [addVenueOpen, setAddVenueOpen] = useState(false)
  const [addVenueName, setAddVenueName] = useState('')
  const [addVenueAddress, setAddVenueAddress] = useState('')
  const [addVenueCategory, setAddVenueCategory] = useState<
    'food' | 'coffee' | 'nightlife' | 'retail' | 'fitness' | 'arts'
  >('food')
  const [addVenueLoading, setAddVenueLoading] = useState(false)
  const [addVenueError, setAddVenueError] = useState('')
  const [mapsUnavailable, setMapsUnavailable] = useState(false)
  const [addVenueLat, setAddVenueLat] = useState<number | undefined>(undefined)
  const [addVenueLng, setAddVenueLng] = useState<number | undefined>(undefined)
  const addressInputRef = useRef<HTMLInputElement>(null)

  // Edit-mode state for the selected venue
  const [editAddress, setEditAddress] = useState('')
  const [editCategory, setEditCategory] = useState<'food' | 'coffee' | 'nightlife' | 'retail' | 'fitness' | 'arts'>(
    'food',
  )
  const [editLat, setEditLat] = useState<number | undefined>(undefined)
  const [editLng, setEditLng] = useState<number | undefined>(undefined)
  const editAddressInputRef = useRef<HTMLInputElement>(null)

  // Photo upload state
  const photoInputRef = useRef<HTMLInputElement>(null)
  const [photoUploading, setPhotoUploading] = useState(false)
  const [photoDeleting, setPhotoDeleting] = useState(false)
  const [photoMessage, setPhotoMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  // Header image state
  const [headerImageUrl, setHeaderImageUrl] = useState<string | null>(null)

  // Instagram handle state
  const [instagramHandle, setInstagramHandle] = useState('')
  const [instagramSaving, setInstagramSaving] = useState(false)

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
        setLoadError(true)
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
      setEditCategory(node.category as typeof editCategory)
      setEditAddress('')
      setEditLat(undefined)
      setEditLng(undefined)
      setSaveError(null)
      setSaveSuccess(false)
    }
  }

  // Seed edit state when selected changes (including initial load)
  useEffect(() => {
    if (!selected) return
    setEditCategory(selected.category as typeof editCategory)
    setEditAddress('')
    setEditLat(undefined)
    setEditLng(undefined)

    // Seed header image preview
    setHeaderImageUrl(mediaUrl(selected.headerImageKey))

    // Seed Instagram handle
    setInstagramHandle(selected.instagramHandle ?? '')
  }, [selected?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  async function handleAddVenue() {
    const currentAddress = (addressInputRef.current?.value || addVenueAddress).trim()
    if (!addVenueName.trim() || !currentAddress) return
    setAddVenueLoading(true)
    setAddVenueError('')
    try {
      const address = (addressInputRef.current?.value || addVenueAddress).trim()
      await api.post<{ id: string; name: string }>('/v1/nodes/business-create', {
        name: addVenueName.trim(),
        category: addVenueCategory,
        address,
        ...(addVenueLat !== undefined && addVenueLng !== undefined ? { lat: addVenueLat, lng: addVenueLng } : {}),
      })
      setAddVenueOpen(false)
      setAddVenueName('')
      setAddVenueAddress('')
      setAddVenueCategory('food')
      setAddVenueLat(undefined)
      setAddVenueLng(undefined)
      // Refresh nodes list
      const nodesRes = await api.get<{ items: Node[] }>('/v1/business/me/nodes')
      const items = nodesRes.items ?? []
      setNodes(items)
      if (items[0]) {
        setSelected(items[0])
        setName(items[0].name)
      }
    } catch (err: unknown) {
      setAddVenueError((err as { message?: string })?.message || 'Failed to add venue')
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
      const typedAddress = (editAddressInputRef.current?.value || editAddress).trim()
      const payload: Record<string, unknown> = { name: name.trim(), category: editCategory }
      if (typedAddress) {
        payload['address'] = typedAddress
        if (editLat !== undefined && editLng !== undefined) {
          payload['lat'] = editLat
          payload['lng'] = editLng
        }
      }
      await api.put(`/v1/nodes/${selected.id}`, payload)
      // Refresh nodes to pick up any lat/lng changes
      const nodesRes = await api.get<{ items: Node[] }>('/v1/business/me/nodes')
      const items = nodesRes.items ?? []
      setNodes(items)
      const updated = items.find((n) => n.id === selected.id) ?? null
      if (updated) setSelected(updated)
      setEditAddress('')
      setEditLat(undefined)
      setEditLng(undefined)
      setSaveSuccess(true)
      setTimeout(() => setSaveSuccess(false), 3000)
    } catch (err: unknown) {
      setSaveError((err as { message?: string })?.message || 'Failed to save changes. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  async function handlePhotoSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = '' // reset so same file can be re-picked
    if (!file || !selected) return

    if (!['image/jpeg', 'image/png'].includes(file.type)) {
      setPhotoMessage({ type: 'error', text: 'Only JPG or PNG allowed.' })
      return
    }
    if (file.size > MAX_HEADER_IMAGE_BYTES) {
      setPhotoMessage({ type: 'error', text: `Image must be under ${MAX_HEADER_IMAGE_LABEL}.` })
      return
    }

    setPhotoUploading(true)
    setPhotoMessage(null)
    try {
      // Downscale and re-encode in the browser: the server has no image
      // processing (sharp is not in the API Lambda), so this is what keeps
      // served bytes small and strips EXIF/GPS. Upload the compressed result.
      const upload = await compressImageFile(file)
      const presigned = await api.post<{ uploadUrl: string; objectKey: string }>(
        `/v1/business/nodes/${selected.id}/image/upload-url`,
        { contentType: upload.type },
      )
      const putRes = await fetch(presigned.uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': upload.type },
        body: upload,
      })
      if (!putRes.ok) throw new Error(`S3 upload failed (${putRes.status})`)
      // Sanitise the upload server-side (strip EXIF/GPS, resize, WebP) and use
      // the returned final key. Non-fatal if processing is unavailable - the
      // backend keeps the raw upload and returns its key.
      let finalKey = presigned.objectKey
      try {
        const processed = await api.post<{ headerImageKey: string }>(
          `/v1/business/nodes/${selected.id}/image/process`,
          {},
        )
        if (processed?.headerImageKey) finalKey = processed.headerImageKey
      } catch {
        /* keep raw key */
      }
      setHeaderImageUrl(mediaUrl(finalKey))
      const updated = { ...selected, headerImageKey: finalKey }
      setSelected(updated)
      setNodes(nodes.map((node) => (node.id === selected.id ? updated : node)))
      setPhotoMessage({ type: 'success', text: 'Photo uploaded.' })
      setTimeout(() => setPhotoMessage(null), 3000)
    } catch (err: unknown) {
      setPhotoMessage({ type: 'error', text: (err as { message?: string })?.message || 'Upload failed.' })
    } finally {
      setPhotoUploading(false)
    }
  }

  async function handlePhotoDelete() {
    // Gate on the stored key, not the resolved preview URL: a photo uploaded
    // while the CDN base is unset has a key but no previewable URL, and the
    // owner must still be able to remove it.
    if (!selected || !selected.headerImageKey) return
    setPhotoDeleting(true)
    setPhotoMessage(null)
    try {
      await api.delete(`/v1/business/nodes/${selected.id}/image`)
      const updated = { ...selected, headerImageKey: null }
      setHeaderImageUrl(null)
      setSelected(updated)
      setNodes(nodes.map((node) => (node.id === selected.id ? updated : node)))
      setPhotoMessage({ type: 'success', text: 'Photo removed.' })
      setTimeout(() => setPhotoMessage(null), 3000)
    } catch (err: unknown) {
      setPhotoMessage({ type: 'error', text: (err as { message?: string })?.message || 'Delete failed.' })
    } finally {
      setPhotoDeleting(false)
    }
  }

  // Whether the selected venue has a stored photo key. Distinct from
  // `headerImageUrl` (the resolved preview URL): a key can exist while the URL
  // is null because the CDN base is unset, which drives the unavailable state.
  const hasHeaderKey = typeof selected?.headerImageKey === 'string' && selected.headerImageKey.trim() !== ''

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
        <h2 className="text-[var(--text-primary)] font-bold text-xl font-[Syne]">Your Venue</h2>
        {nodes.length === 0 && (
          <button
            onClick={() => setAddVenueOpen(true)}
            className="bg-[var(--accent)] text-white font-semibold rounded-xl px-4 py-2 text-sm"
          >
            + Create Your Venue
          </button>
        )}
      </div>

      {loadError ? (
        <p className="text-[var(--danger)] text-sm">Failed to load your venues. Please refresh.</p>
      ) : nodes.length === 0 ? (
        <p className="text-[var(--text-muted)] text-sm">No nodes yet. Add your venue by entering your address below.</p>
      ) : (
        <div className="flex flex-col gap-4">
          {nodes.length > 1 && (
            <select
              value={selected?.id ?? ''}
              onChange={(e) => handleSelectNode(e.target.value)}
              className="bg-[var(--bg-raised)] border border-[var(--border)] text-[var(--text-primary)] rounded-xl px-4 py-3 text-sm focus:border-[var(--accent)] focus:outline-none appearance-none"
            >
              {nodes.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.name}
                </option>
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

              <div className="flex flex-col gap-2">
                <label className="text-[var(--text-secondary)] text-xs font-medium">Category</label>
                <select
                  value={editCategory}
                  onChange={(e) => setEditCategory(e.target.value as typeof editCategory)}
                  className="bg-[var(--bg-raised)] border border-[var(--border)] text-[var(--text-primary)] rounded-xl px-4 py-3 text-sm focus:border-[var(--accent)] focus:outline-none appearance-none"
                >
                  <option value="food">Food</option>
                  <option value="coffee">Coffee</option>
                  <option value="nightlife">Nightlife</option>
                  <option value="retail">Retail</option>
                  <option value="fitness">Fitness</option>
                  <option value="arts">Arts</option>
                </select>
              </div>

              <div className="flex flex-col gap-2">
                <label className="text-[var(--text-secondary)] text-xs font-medium">
                  Address <span className="text-[var(--text-muted)]">(leave blank to keep current)</span>
                </label>
                <MapboxAddressInput
                  inputRef={editAddressInputRef}
                  value={editAddress}
                  onTextChange={(text) => {
                    setEditAddress(text)
                    setEditLat(undefined)
                    setEditLng(undefined)
                  }}
                  onSelect={({ address, lat, lng }) => {
                    setEditAddress(address)
                    setEditLat(lat)
                    setEditLng(lng)
                  }}
                  placeholder="Type new address to change location"
                  className="w-full bg-[var(--bg-raised)] border border-[var(--border)] text-[var(--text-primary)] rounded-xl px-4 py-3 text-sm placeholder:text-[var(--text-muted)] focus:border-[var(--accent)] focus:outline-none"
                />
                <span className="text-[var(--text-muted)] text-xs">
                  Current location: {selected.lat.toFixed(4)}, {selected.lng.toFixed(4)}
                  {selected.claimStatus && (
                    <>
                      {' '}
                      &middot; <span className="capitalize">{selected.claimStatus.replace(/_/g, ' ')}</span>
                    </>
                  )}
                </span>
              </div>

              <div className="flex flex-col gap-2">
                <label className="text-[var(--text-secondary)] text-xs font-medium">Business Photo</label>
                <input
                  ref={photoInputRef}
                  type="file"
                  accept="image/jpeg,image/png"
                  onChange={(e) => void handlePhotoSelected(e)}
                  className="hidden"
                />
                <button
                  onClick={() => photoInputRef.current?.click()}
                  disabled={photoUploading || photoDeleting}
                  className="relative w-full aspect-square overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--bg-raised)] disabled:opacity-50"
                >
                  {headerImageUrl ? (
                    <MediaImage
                      src={headerImageUrl}
                      alt="Header preview"
                      className="w-full h-full object-cover"
                      fallbackClassName="absolute inset-0"
                    />
                  ) : hasHeaderKey ? (
                    // Photo exists but the CDN base is unset, so it cannot be
                    // previewed. Show the honest unavailable state rather than
                    // "Add business photo" (R5.3, no silent success-without-preview).
                    <PhotoUnavailable className="absolute inset-0" />
                  ) : (
                    <span className="absolute inset-0 flex items-center justify-center px-6 text-center text-[var(--text-muted)] text-sm">
                      Add business photo
                    </span>
                  )}
                  {(photoUploading || hasHeaderKey) && (
                    <span className="absolute inset-x-0 bottom-0 bg-black/55 text-white text-xs font-medium py-2">
                      {photoUploading ? 'Uploading...' : 'Replace'}
                    </span>
                  )}
                  {hasHeaderKey && (
                    <span
                      role="button"
                      tabIndex={0}
                      onClick={(e) => {
                        e.stopPropagation()
                        void handlePhotoDelete()
                      }}
                      onKeyDown={(e) => {
                        if (e.key !== 'Enter' && e.key !== ' ') return
                        e.preventDefault()
                        e.stopPropagation()
                        void handlePhotoDelete()
                      }}
                      className="absolute top-3 right-3 rounded-full bg-black/65 text-white text-xs font-semibold px-3 py-1.5"
                    >
                      {photoDeleting ? 'Removing...' : 'Remove'}
                    </span>
                  )}
                </button>
              </div>
              {photoMessage && (
                <p
                  className={`text-xs ${
                    photoMessage.type === 'success' ? 'text-[var(--success)]' : 'text-[var(--danger)]'
                  }`}
                >
                  {photoMessage.text}
                </p>
              )}

              {/* Instagram Handle */}
              <div className="flex flex-col gap-2">
                <label className="text-[var(--text-secondary)] text-xs font-medium">Instagram Handle</label>
                <div className="flex flex-row gap-2">
                  <input
                    type="text"
                    value={instagramHandle}
                    onChange={(e) => setInstagramHandle(e.target.value.replace(/^@/, ''))}
                    placeholder="e.g. yourhandle"
                    className="flex-1 bg-[var(--bg-raised)] border border-[var(--border)] text-[var(--text-primary)] rounded-xl px-4 py-3 text-sm placeholder:text-[var(--text-muted)] focus:border-[var(--accent)] focus:outline-none"
                  />
                  <button
                    onClick={() => {
                      if (!selected) return
                      setInstagramSaving(true)
                      api
                        .put(`/v1/business/nodes/${selected.id}/instagram`, {
                          handle: instagramHandle || null,
                        })
                        .then(() => setPhotoMessage({ type: 'success', text: 'Instagram saved.' }))
                        .catch(() => setPhotoMessage({ type: 'error', text: 'Failed to save Instagram.' }))
                        .finally(() => {
                          setInstagramSaving(false)
                          setTimeout(() => setPhotoMessage(null), 3000)
                        })
                    }}
                    disabled={instagramSaving}
                    className="border border-[var(--border-strong)] text-[var(--text-primary)] rounded-xl px-4 py-2.5 text-sm disabled:opacity-50"
                  >
                    {instagramSaving ? '...' : 'Save'}
                  </button>
                </div>
                {instagramHandle && (
                  <a
                    href={`https://instagram.com/${instagramHandle}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[var(--accent)] text-xs"
                  >
                    @{instagramHandle}
                  </a>
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
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center z-50 p-5">
          <div className="bg-[var(--bg-modal)] border border-[var(--border)] rounded-2xl p-6 max-w-sm w-full max-h-[85dvh] overflow-y-auto shadow-2xl">
            <h3 className="text-[var(--text-primary)] font-bold text-lg mb-4 font-[Syne]">Add Your Venue</h3>
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
              {mapsUnavailable && (
                <p className="text-[var(--text-muted)] text-xs -mt-1">
                  Autocomplete unavailable | enter address manually.
                </p>
              )}
              <MapboxAddressInput
                inputRef={addressInputRef}
                value={addVenueAddress}
                onTextChange={(text) => {
                  setAddVenueAddress(text)
                  setAddVenueLat(undefined)
                  setAddVenueLng(undefined)
                }}
                onSelect={({ address, lat, lng }) => {
                  setAddVenueAddress(address)
                  setAddVenueLat(lat)
                  setAddVenueLng(lng)
                }}
                onUnavailable={() => setMapsUnavailable(true)}
                placeholder="e.g. 73 Juta Street, Braamfontein, Johannesburg"
                className="w-full bg-[var(--bg-raised)] border border-[var(--border)] text-[var(--text-primary)] rounded-xl px-4 py-3 text-sm placeholder:text-[var(--text-muted)] focus:border-[var(--accent)] focus:outline-none"
              />
              <label className="text-[var(--text-primary)] text-xs font-medium">Category</label>
              <select
                value={addVenueCategory}
                onChange={(e) => setAddVenueCategory(e.target.value as typeof addVenueCategory)}
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
                disabled={addVenueLoading || !addVenueName.trim()}
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
