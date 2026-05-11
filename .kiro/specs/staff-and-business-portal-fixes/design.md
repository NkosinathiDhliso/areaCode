# Staff and Business Portal Fixes — Bugfix Design

## Overview

This design addresses three bugs across the Staff Portal and Business Portal:

1. **QR Camera Race Condition** — The `startCamera()` function in `StaffValidator.tsx` sets `scanning = true` and uses `requestAnimationFrame` to access `videoRef.current`, but React hasn't re-rendered the `<video>` element yet. Additionally, browsers without `BarcodeDetector` (Safari, Firefox) have no fallback QR decoder.

2. **NodeEditorPanel Misplaced in LivePanel** — The full venue editor is rendered inside the Live dashboard, mixing settings with real-time data. It belongs in the Settings panel.

3. **Photo Upload Preview Not Updating** — After a successful photo upload in `NodeEditorPanel.tsx`, the `headerImageUrl` state is never updated with the new CDN URL, so the preview doesn't appear until the user navigates away and back.

## Glossary

- **Bug_Condition (C)**: The set of conditions that trigger each bug — race condition on video ref, misplaced component render, missing state update after upload
- **Property (P)**: The desired correct behavior — video element ready before stream attach, NodeEditorPanel only in Settings, immediate preview after upload
- **Preservation**: Existing behaviors that must remain unchanged — native BarcodeDetector usage, manual code entry, live dashboard stats, photo validation errors, node selection
- **StaffValidator**: The component in `packages/features/staff/StaffValidator.tsx` that handles QR scanning and manual redemption code entry
- **NodeEditorPanel**: The component in `apps/business/src/screens/panels/NodeEditorPanel.tsx` that manages venue name, address, category, photo, and Instagram handle
- **LivePanel**: The component in `apps/business/src/screens/panels/LivePanel.tsx` that displays real-time check-in stats and live avatars
- **SettingsPanel**: The component in `apps/business/src/screens/panels/SettingsPanel.tsx` that displays subscription, staff management, and QR code generation
- **jsQR**: A pure JavaScript QR code reading library that decodes QR codes from canvas image data
- **BarcodeDetector**: A native browser API (Chrome/Edge) for detecting barcodes from image/video sources

## Bug Details

### Bug Condition

The bugs manifest across three independent conditions:

**Bug 1**: When `startCamera()` is called, `scanning` is set to `true` and `requestAnimationFrame` fires before React re-renders the `<video>` element, so `videoRef.current` is `null`. Additionally, when `BarcodeDetector` is unavailable, the scanner gives up entirely.

**Bug 2**: When the user navigates to the Live panel, `NodeEditorPanel` is rendered inside it unconditionally, mixing venue configuration with live stats.

**Bug 3**: When `handlePhotoSelected` completes a successful upload (steps 1-3 all succeed), the function never calls `setHeaderImageUrl(...)` with the new CDN path, leaving the preview stale.

**Formal Specification:**

```
FUNCTION isBugCondition(input)
  INPUT: input of type { bug: 1 | 2 | 3, context: BugContext }
  OUTPUT: boolean

  IF input.bug == 1 THEN
    RETURN (input.context.scanning == true
            AND input.context.videoRefCurrent == null)
           OR (input.context.barcodeDetectorAvailable == false
               AND input.context.cameraStreamActive == true)
  END IF

  IF input.bug == 2 THEN
    RETURN input.context.currentPanel == 'live'
           AND NodeEditorPanel IS rendered inside LivePanel
  END IF

  IF input.bug == 3 THEN
    RETURN input.context.uploadSucceeded == true
           AND input.context.headerImageUrl == previousValue
  END IF
END FUNCTION
```

### Examples

- **Bug 1 (Race)**: User taps "Scan QR Code" → camera stream obtained → `requestAnimationFrame` fires → `videoRef.current` is `null` → stream never attached → black/empty scanner view
- **Bug 1 (Fallback)**: User on Safari taps "Scan QR Code" → camera opens → `BarcodeDetector` is `undefined` → error message shown → camera stopped → no QR scanning possible
- **Bug 2**: User swipes to Live panel → sees venue name input, address field, category dropdown, photo upload button mixed in with check-in count and live avatars
- **Bug 3**: User clicks "Add Photo" → selects image → upload succeeds → "Photo uploaded." message appears → header image preview area remains empty → user must navigate away and return to see the image
- **Edge case (Bug 3)**: User uploads a photo for a node that already has a header image → old image continues showing → new image only appears after page refresh

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**

- Native `BarcodeDetector` usage on Chrome/Edge must continue to work as the primary QR scanner
- Camera permission denial must continue to show the error message and allow manual code entry
- Successful QR scan must continue to extract the code and trigger the preview flow
- Manual code entry and validation must continue to work identically
- Live panel must continue to display check-in count, live avatars, rewards claimed, and zero-state tips
- Panel navigation/swiping must continue to work in the existing order
- Photo upload validation (format, size) must continue to show appropriate errors
- Node selection must continue to load the correct header image for each node
- Saving venue changes (name, category, address) must continue to persist and show success

**Scope:**
All inputs that do NOT involve the three bug conditions should be completely unaffected by these fixes. This includes:

- Mouse/touch interactions with buttons and forms
- Manual redemption code entry flow
- Live stats polling and socket event handling
- Staff management, subscription display, and QR code generation in Settings
- Google Places autocomplete for address fields

## Hypothesized Root Cause

### Bug 1: QR Camera Race Condition

1. **React render timing**: Setting `scanning = true` via `setScanning(true)` triggers a state update, but the `<video>` element is conditionally rendered (`{scanning && ...}`). `requestAnimationFrame` fires before React commits the new DOM, so `videoRef.current` is still `null`.

2. **No retry/polling for video element**: The code assumes one `requestAnimationFrame` is sufficient, but React's batched updates may not have flushed by then.

3. **No jsQR fallback**: The `startScanning()` function only checks for `BarcodeDetector` and immediately gives up if unavailable, rather than using a canvas + jsQR approach.

### Bug 2: NodeEditorPanel in LivePanel

1. **Incorrect component placement**: `NodeEditorPanel` was imported and rendered directly inside `LivePanel.tsx` (line 11 import, line 80 render), likely added during development for convenience and never moved to its proper location.

### Bug 3: Photo Upload Missing Preview

1. **Missing state update**: In `handlePhotoSelected`, after the three upload steps succeed, the function sets `photoMessage` but never calls `setHeaderImageUrl(...)` with the new CDN URL constructed from `VITE_CDN_URL` + `presigned.s3Key`.

2. **No node data refresh**: Unlike `handleSave()` which refreshes nodes after saving, `handlePhotoSelected` doesn't re-fetch the node to pick up the new `headerImageKey`.

## Correctness Properties

Property 1: Bug Condition - Video Element Available Before Stream Attach

_For any_ call to `startCamera()` where the camera stream is successfully obtained, the fixed function SHALL wait until `videoRef.current` is non-null and the video element is in the DOM before attaching `srcObject` and calling `play()`, ensuring the camera feed is always visible to the user.

**Validates: Requirements 2.1**

Property 2: Bug Condition - jsQR Fallback for Non-BarcodeDetector Browsers

_For any_ browser environment where `window.BarcodeDetector` is undefined, the fixed `startScanning()` function SHALL use a canvas-based jsQR fallback to decode QR codes from the video feed, providing QR scanning capability on Safari and Firefox.

**Validates: Requirements 2.2**

Property 3: Bug Condition - NodeEditorPanel Not in LivePanel

_For any_ render of the Live panel, the fixed `LivePanel` component SHALL NOT render `NodeEditorPanel` or any venue configuration UI, displaying only real-time content (check-in count, avatars, rewards, tips).

**Validates: Requirements 2.3**

Property 4: Bug Condition - NodeEditorPanel in SettingsPanel

_For any_ render of the Settings panel, the fixed `SettingsPanel` component SHALL render the `NodeEditorPanel` venue management UI alongside existing settings content.

**Validates: Requirements 2.4**

Property 5: Bug Condition - Immediate Photo Preview After Upload

_For any_ successful photo upload (presigned URL obtained, S3 PUT succeeds, image registered), the fixed `handlePhotoSelected` function SHALL immediately update `headerImageUrl` state with `${VITE_CDN_URL}/${s3Key}`, causing the preview to display the new image without navigation.

**Validates: Requirements 2.5, 2.6**

Property 6: Preservation - Existing Non-Bug Behavior Unchanged

_For any_ input that does NOT involve the three bug conditions (manual code entry, live stats display, photo validation errors, node selection, panel navigation), the fixed code SHALL produce exactly the same behavior as the original code, preserving all existing functionality.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10**

## Fix Implementation

### Changes Required

**File**: `packages/features/staff/StaffValidator.tsx`

**Function**: `startCamera()`

**Specific Changes**:

1. **Replace requestAnimationFrame with polling/retry**: After `setScanning(true)`, poll for `videoRef.current` to become non-null (e.g., retry every 50ms up to 2 seconds) before attaching the stream. This handles React's async rendering.

   ```typescript
   async function waitForVideoElement(maxWait = 2000): Promise<HTMLVideoElement | null> {
     const start = Date.now()
     while (Date.now() - start < maxWait) {
       if (videoRef.current) return videoRef.current
       await new Promise((r) => setTimeout(r, 50))
     }
     return null
   }
   ```

2. **Attach stream only when video element is ready**:

   ```typescript
   const video = await waitForVideoElement()
   if (video && streamRef.current) {
     video.srcObject = streamRef.current
     await video.play()
     startScanning()
   } else {
     setCameraError('Camera failed to initialize. Please try again.')
     stopCamera()
   }
   ```

3. **Add jsQR fallback in startScanning()**: When `BarcodeDetector` is unavailable, use canvas + jsQR to decode frames:

   ```typescript
   import jsQR from 'jsqr'
   // In startScanning() else branch:
   scanIntervalRef.current = setInterval(() => {
     if (!videoRef.current || !canvasRef.current || videoRef.current.readyState < 2) return
     const canvas = canvasRef.current
     const ctx = canvas.getContext('2d')
     canvas.width = videoRef.current.videoWidth
     canvas.height = videoRef.current.videoHeight
     ctx.drawImage(videoRef.current, 0, 0)
     const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
     const qrCode = jsQR(imageData.data, canvas.width, canvas.height)
     if (qrCode?.data) {
       stopCamera()
       handleCodeScanned(qrCode.data)
     }
   }, 300)
   ```

4. **Install jsQR dependency**: Add `jsqr` package to the staff features package.

---

**File**: `apps/business/src/screens/panels/LivePanel.tsx`

**Function**: Component render

**Specific Changes**:

1. **Remove NodeEditorPanel import**: Delete `import { NodeEditorPanel } from './NodeEditorPanel'` (line 11)
2. **Remove NodeEditorPanel render**: Delete the wrapping `<div>` and `<NodeEditorPanel />` from the JSX (lines 79-81)

---

**File**: `apps/business/src/screens/panels/SettingsPanel.tsx`

**Function**: Component render

**Specific Changes**:

1. **Import NodeEditorPanel**: Add `import { NodeEditorPanel } from './NodeEditorPanel'`
2. **Render NodeEditorPanel**: Add `<NodeEditorPanel />` wrapped in a surface container at the top of the settings content (after the title, before subscription section), matching the existing card styling

---

**File**: `apps/business/src/screens/panels/NodeEditorPanel.tsx`

**Function**: `handlePhotoSelected()`

**Specific Changes**:

1. **Update headerImageUrl after successful upload**: After step 3 (registering the image), immediately set the preview URL:
   ```typescript
   // After: await api.post(`/v1/nodes/${selected.id}/images`, { s3Key: presigned.s3Key, displayOrder: 0 })
   const cdnUrl = import.meta.env['VITE_CDN_URL'] as string | undefined
   if (cdnUrl) {
     setHeaderImageUrl(`${cdnUrl}/${presigned.s3Key}`)
   }
   ```

## Testing Strategy

### Validation Approach

The testing strategy follows a two-phase approach: first, surface counterexamples that demonstrate the bugs on unfixed code, then verify the fixes work correctly and preserve existing behavior.

### Exploratory Bug Condition Checking

**Goal**: Surface counterexamples that demonstrate the bugs BEFORE implementing the fix. Confirm or refute the root cause analysis. If we refute, we will need to re-hypothesize.

**Test Plan**: Write unit tests that simulate the race condition, missing BarcodeDetector, component rendering, and photo upload flow. Run these tests on the UNFIXED code to observe failures.

**Test Cases**:

1. **Video Ref Race Test**: Mock `requestAnimationFrame` and verify that `videoRef.current` is null when the callback fires before React re-renders (will fail on unfixed code — stream never attached)
2. **jsQR Fallback Test**: Set `window.BarcodeDetector = undefined` and call `startScanning()` — verify QR decoding still works (will fail on unfixed code — camera stops immediately)
3. **LivePanel Content Test**: Render `LivePanel` and assert `NodeEditorPanel` is NOT present (will fail on unfixed code — NodeEditorPanel is rendered)
4. **Photo Preview Update Test**: Simulate successful upload flow and assert `headerImageUrl` is updated (will fail on unfixed code — state never changes)

**Expected Counterexamples**:

- `videoRef.current` is null inside `requestAnimationFrame` callback after `setScanning(true)`
- `startScanning()` calls `stopCamera()` when `BarcodeDetector` is undefined
- `LivePanel` render tree contains `NodeEditorPanel` component
- `headerImageUrl` remains `null` after successful upload completes

### Fix Checking

**Goal**: Verify that for all inputs where the bug condition holds, the fixed function produces the expected behavior.

**Pseudocode:**

```
FOR ALL input WHERE isBugCondition(input) DO
  IF input.bug == 1 THEN
    result := startCamera_fixed()
    ASSERT videoElement.srcObject == stream
    ASSERT scanningActive == true
  END IF

  IF input.bug == 2 THEN
    result := render(LivePanel_fixed)
    ASSERT NOT contains(result, NodeEditorPanel)
    result2 := render(SettingsPanel_fixed)
    ASSERT contains(result2, NodeEditorPanel)
  END IF

  IF input.bug == 3 THEN
    result := handlePhotoSelected_fixed(validImage)
    ASSERT headerImageUrl == `${CDN_URL}/${s3Key}`
  END IF
END FOR
```

### Preservation Checking

**Goal**: Verify that for all inputs where the bug condition does NOT hold, the fixed function produces the same result as the original function.

**Pseudocode:**

```
FOR ALL input WHERE NOT isBugCondition(input) DO
  ASSERT originalFunction(input) = fixedFunction(input)
END FOR
```

**Testing Approach**: Property-based testing is recommended for preservation checking because:

- It generates many test cases automatically across the input domain
- It catches edge cases that manual unit tests might miss
- It provides strong guarantees that behavior is unchanged for all non-buggy inputs

**Test Plan**: Observe behavior on UNFIXED code first for manual code entry, live stats rendering, photo validation, and node selection, then write property-based tests capturing that behavior.

**Test Cases**:

1. **Manual Code Entry Preservation**: Verify that entering codes manually and pressing Validate continues to trigger the preview flow identically
2. **Live Stats Preservation**: Verify that check-in count, avatars, rewards counter, and zero-state tips render correctly without NodeEditorPanel
3. **Photo Validation Preservation**: Verify that invalid file types and oversized files continue to show error messages
4. **Node Selection Preservation**: Verify that selecting different nodes loads the correct header image from existing `headerImageKey`
5. **Settings Panel Preservation**: Verify subscription, staff management, and QR generation continue to work alongside the newly added NodeEditorPanel

### Unit Tests

- Test `waitForVideoElement` utility resolves when ref becomes available
- Test `waitForVideoElement` times out and returns null after max wait
- Test jsQR fallback decodes a known QR code from canvas image data
- Test `LivePanel` does not render `NodeEditorPanel`
- Test `SettingsPanel` renders `NodeEditorPanel`
- Test `handlePhotoSelected` updates `headerImageUrl` after successful upload
- Test `handlePhotoSelected` does NOT update `headerImageUrl` on upload failure

### Property-Based Tests

- Generate random timing delays for video element availability and verify stream is always attached once element appears
- Generate random browser environments (with/without BarcodeDetector) and verify QR scanning always has a working decoder
- Generate random panel navigation sequences and verify NodeEditorPanel only appears in Settings
- Generate random upload results (success/failure) and verify headerImageUrl is updated only on success

### Integration Tests

- Test full QR scan flow: camera permission → stream → video visible → QR decoded → preview shown
- Test full photo upload flow: file selected → presigned URL → S3 upload → register → preview visible
- Test panel navigation: Live shows stats only, Settings shows venue editor + existing settings
- Test cross-browser: verify jsQR fallback works when BarcodeDetector is shimmed away
