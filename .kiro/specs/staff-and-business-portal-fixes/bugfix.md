# Bugfix Requirements Document

## Introduction

This document addresses three bugs across the Staff Portal and Business Portal applications:

1. **QR Camera not working in Staff Portal** — The QR scanner in `StaffValidator.tsx` fails due to a race condition where `videoRef.current` is null when accessed immediately after setting `scanning = true`, and lacks a fallback QR library for browsers without `BarcodeDetector` API support (Safari, Firefox).

2. **NodeEditorPanel embedded in Live dashboard** — The `NodeEditorPanel` (venue settings/configuration) is rendered directly inside `LivePanel.tsx`, mixing settings content with the live dashboard. It should only appear in the Settings panel or as its own dedicated panel.

3. **Photo upload doesn't show preview after upload** — In `NodeEditorPanel.tsx`, after a photo is uploaded successfully, the `headerImageUrl` state is never updated with the new image. The node data isn't refreshed post-upload, so the preview only appears after navigating away and back.

## Bug Analysis

### Current Behavior (Defect)

**Bug 1: QR Camera Race Condition & Missing Fallback**

1.1 WHEN `startCamera()` is called THEN the system sets `scanning = true` and immediately uses `requestAnimationFrame` to access `videoRef.current`, but React has not yet re-rendered the `<video>` element so `videoRef.current` is null and the camera stream is never attached to the video element

1.2 WHEN the browser does not support the `BarcodeDetector` API (Safari, Firefox) THEN the system displays "QR scanning not supported in this browser" and stops the camera, providing no QR decoding capability

**Bug 2: NodeEditorPanel in Live Dashboard**

1.3 WHEN the user navigates to the Live panel THEN the system renders the full `NodeEditorPanel` (venue name editing, address, category, photo upload, Instagram handle) inside the live dashboard, mixing configuration/settings content with real-time check-in data

**Bug 3: Photo Upload Missing Preview**

1.4 WHEN a photo is successfully uploaded via the "Add Photo" button THEN the system does not update `headerImageUrl` state with the newly uploaded image, so no preview is shown

1.5 WHEN a photo is successfully uploaded THEN the system does not refresh the node data to pick up the new `headerImageKey`, so the header image preview remains empty until the user navigates away and returns

1.6 WHEN a photo is uploaded successfully THEN the system only shows a brief "Photo uploaded." text message with no thumbnail or visual preview of the uploaded image

### Expected Behavior (Correct)

**Bug 1: QR Camera Race Condition & Missing Fallback**

2.1 WHEN `startCamera()` is called THEN the system SHALL wait for the `<video>` element to be rendered and available in the DOM before attaching the camera stream and starting QR scanning

2.2 WHEN the browser does not support the `BarcodeDetector` API THEN the system SHALL use a JavaScript-based QR decoding library (e.g., `jsQR`) as a fallback to decode QR codes from the camera feed

**Bug 2: NodeEditorPanel in Live Dashboard**

2.3 WHEN the user navigates to the Live panel THEN the system SHALL display only live/real-time content (check-in count, live avatars, rewards claimed, zero-state tips) without any venue settings or configuration UI

2.4 WHEN the user navigates to the Settings panel THEN the system SHALL display the venue management functionality (name editing, address, category, photo upload, Instagram handle) that was previously in the Live panel

**Bug 3: Photo Upload Missing Preview**

2.5 WHEN a photo is successfully uploaded THEN the system SHALL immediately update the header image preview to display the newly uploaded photo without requiring navigation away and back

2.6 WHEN a photo is successfully uploaded THEN the system SHALL refresh the node data or directly set the `headerImageUrl` state using the known S3 key and CDN URL so the preview reflects the latest upload

### Unchanged Behavior (Regression Prevention)

**Bug 1: QR Camera**

3.1 WHEN the `BarcodeDetector` API is available (Chrome, Edge) THEN the system SHALL CONTINUE TO use the native `BarcodeDetector` for QR code scanning

3.2 WHEN the user denies camera permission THEN the system SHALL CONTINUE TO display the "Camera access denied" error and allow manual code entry

3.3 WHEN a QR code is successfully scanned THEN the system SHALL CONTINUE TO extract the redemption code and trigger the preview flow

3.4 WHEN the user enters a code manually and presses Validate THEN the system SHALL CONTINUE TO look up and preview the redemption as before

**Bug 2: NodeEditorPanel Location**

3.5 WHEN the user is on the Settings panel THEN the system SHALL CONTINUE TO display subscription info, staff management, and QR code generation alongside the venue management

3.6 WHEN the user swipes between panels THEN the system SHALL CONTINUE TO navigate between panels in the existing order

3.7 WHEN the Live panel loads THEN the system SHALL CONTINUE TO display real-time check-in count, live avatars, rewards claimed counter, and zero-state onboarding tips

**Bug 3: Photo Upload**

3.8 WHEN a photo upload fails (wrong format, too large, S3 error) THEN the system SHALL CONTINUE TO display the appropriate error message

3.9 WHEN the user selects a different node from the dropdown THEN the system SHALL CONTINUE TO load and display that node's existing header image if one exists

3.10 WHEN the user saves venue changes (name, category, address) THEN the system SHALL CONTINUE TO persist those changes and show the success message
