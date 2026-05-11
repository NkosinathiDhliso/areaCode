# Implementation Plan

- [x] 1. Write bug condition exploration test
  - **Property 1: Bug Condition** - QR Camera Race Condition, Missing jsQR Fallback, Misplaced NodeEditorPanel, and Photo Preview Not Updating
  - **CRITICAL**: This test MUST FAIL on unfixed code - failure confirms the bugs exist
  - **DO NOT attempt to fix the test or the code when it fails**
  - **NOTE**: This test encodes the expected behavior - it will validate the fixes when it passes after implementation
  - **GOAL**: Surface counterexamples that demonstrate the bugs exist
  - **Scoped PBT Approach**: Scope properties to the concrete failing cases for each bug
  - Test 1a (Race Condition): Mock `requestAnimationFrame` to fire synchronously after `setScanning(true)`. Assert that `videoRef.current` is non-null and `srcObject` is set to the stream before `play()` is called. On unfixed code, `videoRef.current` is null inside the rAF callback because React hasn't re-rendered the `<video>` element yet.
  - Test 1b (jsQR Fallback): Set `window.BarcodeDetector = undefined`, call `startScanning()`. Assert that QR decoding continues via canvas+jsQR fallback (scanIntervalRef is set, no error shown). On unfixed code, `stopCamera()` is called and error message "QR scanning not supported" is shown.
  - Test 1c (NodeEditorPanel in LivePanel): Render `LivePanel` component. Assert that `NodeEditorPanel` is NOT present in the render tree. On unfixed code, `NodeEditorPanel` IS rendered inside `LivePanel`.
  - Test 1d (Photo Preview): Simulate successful upload flow in `NodeEditorPanel` (presigned URL → S3 PUT → register image). Assert `headerImageUrl` state is updated to `${VITE_CDN_URL}/${s3Key}`. On unfixed code, `headerImageUrl` remains null after upload.
  - Run tests on UNFIXED code
  - **EXPECTED OUTCOME**: Tests FAIL (this is correct - it proves the bugs exist)
  - Document counterexamples: `videoRef.current` is null in rAF, `startScanning()` calls `stopCamera()` when BarcodeDetector undefined, LivePanel contains NodeEditorPanel, headerImageUrl unchanged after upload
  - Mark task complete when tests are written, run, and failures are documented
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6_

- [x] 2. Write preservation property tests (BEFORE implementing fix)
  - **Property 2: Preservation** - Existing Non-Bug Behavior Unchanged
  - **IMPORTANT**: Follow observation-first methodology
  - **Observe on UNFIXED code:**
  - Observe: Manual code entry via input field triggers `handlePreview()` on Enter key and calls `/v1/staff/redeem/{code}/preview`
  - Observe: When `BarcodeDetector` IS available (Chrome/Edge), `startScanning()` creates a detector and sets up interval scanning — this must continue working
  - Observe: Camera permission denial sets `cameraError` to "Camera access denied..." and sets `scanning = false`
  - Observe: Successful QR scan extracts code via regex `/\/qr\/[^/]+\/([a-zA-Z0-9]+)/` and calls `handleCodeScanned()`
  - Observe: LivePanel renders check-in count, live avatars, rewards claimed counter, and zero-state tips
  - Observe: Photo validation rejects non-JPG/PNG/WebP files with "Only JPG, PNG or WebP allowed." and files >5MB with "Image must be under 5MB."
  - Observe: Node selection via `handleSelectNode()` loads correct header image from `headerImageKey` + CDN URL
  - Observe: SettingsPanel renders subscription info, staff management, QR code generation
  - **Write property-based tests capturing observed behavior:**
  - For all valid redemption codes entered manually, the preview API is called with the correct code
  - For all browsers with BarcodeDetector available, native scanning is used (not jsQR)
  - For all camera permission denials, error message is shown and scanning stops
  - For all invalid photo files (wrong type or >5MB), appropriate error message is shown and no upload occurs
  - For all node selections, headerImageUrl is set to `${CDN_URL}/${node.headerImageKey}` when key exists
  - For all renders of SettingsPanel, subscription/staff/QR sections are present
  - Verify tests pass on UNFIXED code
  - **EXPECTED OUTCOME**: Tests PASS (this confirms baseline behavior to preserve)
  - Mark task complete when tests are written, run, and passing on unfixed code
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10_

- [x] 3. Fix for QR camera race condition and missing jsQR fallback
  - [x] 3.1 Install jsqr package
    - Run `npm install jsqr` (or `pnpm add jsqr`) in the appropriate workspace package
    - Add `@types/jsqr` if needed for TypeScript support
    - Verify package is added to `package.json` dependencies
    - _Bug_Condition: isBugCondition(input) where input.context.barcodeDetectorAvailable == false AND input.context.cameraStreamActive == true_
    - _Requirements: 2.2_

  - [x] 3.2 Fix video element race condition in `startCamera()`
    - File: `packages/features/staff/StaffValidator.tsx`
    - Replace `requestAnimationFrame` with a polling/retry approach that waits for `videoRef.current` to become non-null
    - Implement `waitForVideoElement(maxWait = 2000)` that polls every 50ms until video ref is available
    - Only attach `srcObject` and call `play()` once video element is confirmed in DOM
    - If timeout expires, show error "Camera failed to initialize. Please try again." and call `stopCamera()`
    - _Bug_Condition: isBugCondition(input) where input.context.scanning == true AND input.context.videoRefCurrent == null_
    - _Expected_Behavior: Video element is available before stream attach; camera feed is visible to user_
    - _Preservation: Native BarcodeDetector usage on Chrome/Edge continues to work; camera denial still shows error_
    - _Requirements: 2.1, 3.1, 3.2_

  - [x] 3.3 Add jsQR fallback in `startScanning()`
    - File: `packages/features/staff/StaffValidator.tsx`
    - Import `jsQR` from `'jsqr'`
    - In the `else` branch of `startScanning()` (when BarcodeDetector is unavailable):
      - Set up `setInterval` (300ms) that draws video frame to canvas
      - Use `canvasRef.current` to get 2D context, draw video frame, get ImageData
      - Call `jsQR(imageData.data, width, height)` to decode
      - On successful decode, call `stopCamera()` then `handleCodeScanned(qrCode.data)`
    - Remove the "QR scanning not supported" error message and `stopCamera()` call from else branch
    - _Bug_Condition: isBugCondition(input) where input.context.barcodeDetectorAvailable == false_
    - _Expected_Behavior: QR scanning works via jsQR fallback on Safari/Firefox_
    - _Preservation: When BarcodeDetector IS available, native detector is still used_
    - _Requirements: 2.2, 3.1_

  - [x] 3.4 Verify bug condition exploration test now passes (QR bugs)
    - **Property 1: Expected Behavior** - QR Camera Race Condition and jsQR Fallback
    - **IMPORTANT**: Re-run the SAME tests from task 1 (1a and 1b) - do NOT write new tests
    - The tests from task 1 encode the expected behavior
    - When these tests pass, it confirms the race condition is fixed and jsQR fallback works
    - Run bug condition exploration tests 1a and 1b
    - **EXPECTED OUTCOME**: Tests PASS (confirms bugs are fixed)
    - _Requirements: 2.1, 2.2_

  - [x] 3.5 Verify preservation tests still pass (QR behavior)
    - **Property 2: Preservation** - QR Scanner Existing Behavior
    - **IMPORTANT**: Re-run the SAME tests from task 2 - do NOT write new tests
    - Run preservation tests for manual code entry, native BarcodeDetector usage, camera denial
    - **EXPECTED OUTCOME**: Tests PASS (confirms no regressions)
    - Confirm native BarcodeDetector still used when available, manual entry still works, camera denial still handled

- [x] 4. Fix for NodeEditorPanel misplaced in LivePanel
  - [x] 4.1 Remove NodeEditorPanel from LivePanel
    - File: `apps/business/src/screens/panels/LivePanel.tsx`
    - Remove import: `import { NodeEditorPanel } from './NodeEditorPanel'` (line 11)
    - Remove the wrapping `<div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-2xl">` and `<NodeEditorPanel />` from the JSX (lines 79-81)
    - _Bug_Condition: isBugCondition(input) where input.context.currentPanel == 'live' AND NodeEditorPanel IS rendered inside LivePanel_
    - _Expected_Behavior: LivePanel renders only live/real-time content (check-in count, avatars, rewards, tips)_
    - _Preservation: Live stats, avatars, rewards counter, zero-state tips all continue to render correctly_
    - _Requirements: 2.3, 3.6, 3.7_

  - [x] 4.2 Add NodeEditorPanel to SettingsPanel
    - File: `apps/business/src/screens/panels/SettingsPanel.tsx`
    - Add import: `import { NodeEditorPanel } from './NodeEditorPanel'`
    - Render `<NodeEditorPanel />` after the title `<h2>` and before the subscription section
    - Wrap in a consistent container if needed to match existing card styling
    - _Bug_Condition: NodeEditorPanel not accessible from Settings panel_
    - _Expected_Behavior: SettingsPanel displays venue management (name, address, category, photo, Instagram) alongside existing settings_
    - _Preservation: Subscription info, staff management, QR code generation all continue to render in SettingsPanel_
    - _Requirements: 2.4, 3.5_

  - [x] 4.3 Verify bug condition exploration test now passes (NodeEditorPanel location)
    - **Property 1: Expected Behavior** - NodeEditorPanel Not in LivePanel
    - **IMPORTANT**: Re-run the SAME test from task 1 (1c) - do NOT write a new test
    - Run bug condition exploration test 1c
    - **EXPECTED OUTCOME**: Test PASSES (confirms NodeEditorPanel removed from LivePanel)
    - _Requirements: 2.3, 2.4_

  - [x] 4.4 Verify preservation tests still pass (panel behavior)
    - **Property 2: Preservation** - Panel Navigation and Content
    - **IMPORTANT**: Re-run the SAME tests from task 2 - do NOT write new tests
    - Run preservation tests for LivePanel content and SettingsPanel content
    - **EXPECTED OUTCOME**: Tests PASS (confirms no regressions)
    - Confirm live stats still render, settings content still present alongside NodeEditorPanel

- [x] 5. Fix for photo upload preview not updating
  - [x] 5.1 Update headerImageUrl after successful upload in NodeEditorPanel
    - File: `apps/business/src/screens/panels/NodeEditorPanel.tsx`
    - In `handlePhotoSelected()`, after the successful `api.post(\`/v1/nodes/${selected.id}/images\`, ...)` call:
    - Add: `const cdnUrl = import.meta.env['VITE_CDN_URL'] as string | undefined`
    - Add: `if (cdnUrl) { setHeaderImageUrl(\`${cdnUrl}/${presigned.s3Key}\`) }`
    - This immediately updates the preview without requiring navigation away and back
    - _Bug_Condition: isBugCondition(input) where input.context.uploadSucceeded == true AND input.context.headerImageUrl == previousValue_
    - _Expected_Behavior: headerImageUrl is set to `${VITE_CDN_URL}/${s3Key}` immediately after successful upload_
    - _Preservation: Failed uploads continue to show error messages; node selection continues to load existing header images_
    - _Requirements: 2.5, 2.6, 3.8, 3.9_

  - [x] 5.2 Verify bug condition exploration test now passes (photo preview)
    - **Property 1: Expected Behavior** - Immediate Photo Preview After Upload
    - **IMPORTANT**: Re-run the SAME test from task 1 (1d) - do NOT write a new test
    - Run bug condition exploration test 1d
    - **EXPECTED OUTCOME**: Test PASSES (confirms photo preview updates immediately)
    - _Requirements: 2.5, 2.6_

  - [x] 5.3 Verify preservation tests still pass (photo behavior)
    - **Property 2: Preservation** - Photo Upload Validation and Node Selection
    - **IMPORTANT**: Re-run the SAME tests from task 2 - do NOT write new tests
    - Run preservation tests for photo validation errors and node selection header image loading
    - **EXPECTED OUTCOME**: Tests PASS (confirms no regressions)
    - Confirm invalid files still rejected, node selection still loads correct images

- [x] 6. Checkpoint - Ensure all tests pass
  - Run full test suite to confirm all exploration tests (Property 1) now pass
  - Run full test suite to confirm all preservation tests (Property 2) still pass
  - Verify no TypeScript compilation errors across all modified files
  - Verify `jsqr` package is properly installed and importable
  - Ensure all tests pass, ask the user if questions arise.
