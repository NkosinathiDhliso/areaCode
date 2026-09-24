/**
 * Camera plumbing for the staff validator, one home.
 *
 * A camera failure is a different class of failure from an API failure, so it
 * does not go through `describeApiError` (`packages/shared/lib/apiError.ts`).
 * That mapper reasons about HTTP status codes and server error codes; a
 * `getUserMedia` rejection carries neither. What it carries is a `DOMException`
 * name, and the name is the whole diagnosis: a denied permission, a missing
 * camera, and a camera another app is holding all need different instructions
 * from the staff member standing at the till. One generic "camera failed" line
 * leaves them tapping the same button again.
 *
 * Copy rules (`code-style.md`): no emoji, no technical text, and every branch
 * ends in something the staff member can actually do, with manual code entry as
 * the always-available fallback right below the scanner.
 */

/** Names the browsers raise from `getUserMedia`, per the Media Capture spec. */
const CAMERA_ERROR_COPY: Record<string, string> = {
  // Permission denied, or blocked by policy. The prompt will not reappear on its
  // own, so the staff member has to change the site setting.
  NotAllowedError: 'Camera access denied. Allow the camera in your browser settings, or type the code below.',
  // Spec name for the same thing in older Chrome and Safari builds.
  PermissionDeniedError: 'Camera access denied. Allow the camera in your browser settings, or type the code below.',
  // No capture device at all: a desktop till, or a phone with the camera
  // disabled by device management.
  NotFoundError: 'No camera found on this device. Type the code below instead.',
  DevicesNotFoundError: 'No camera found on this device. Type the code below instead.',
  // The device exists but is held by another app or tab.
  NotReadableError: 'The camera is in use by another app. Close it and try again, or type the code below.',
  TrackStartError: 'The camera is in use by another app. Close it and try again, or type the code below.',
  // No camera matches the requested constraints (we ask for the rear camera).
  OverconstrainedError: 'This device has no back camera to scan with. Type the code below instead.',
  ConstraintNotSatisfiedError: 'This device has no back camera to scan with. Type the code below instead.',
  // Insecure context: the page is not on HTTPS, so the camera is unavailable.
  SecurityError: 'The camera needs a secure connection. Open the staff app over https, or type the code below.',
  // Hardware or OS level abort mid-start.
  AbortError: 'The camera stopped before it could start. Try again, or type the code below.',
}

/** Shown when the camera started but the video stream never began playing. */
export const CAMERA_PLAYBACK_FAILED_COPY =
  'The camera did not start showing a picture. Try again, or type the code below.'

/** Shown for an unrecognised failure, so the staff member is never stuck. */
export const CAMERA_UNKNOWN_FAILURE_COPY = 'The camera could not start. Try again, or type the code below.'

/**
 * Plain, actionable copy for a camera failure, chosen by `err.name`.
 *
 * Unknown names fall through to one generic sentence rather than leaking a
 * `DOMException` message into the UI.
 */
export function describeCameraError(err: unknown): string {
  const name = typeof err === 'object' && err !== null ? (err as { name?: unknown }).name : undefined
  if (typeof name === 'string') {
    const copy = CAMERA_ERROR_COPY[name]
    if (copy) return copy
  }
  return CAMERA_UNKNOWN_FAILURE_COPY
}

/**
 * Wait for React to render the `<video>` element the stream attaches to.
 *
 * `setScanning(true)` and the `video` element appearing are two different ticks,
 * so reading the ref straight after the state update finds `null`. Resolves
 * `null` once `maxWait` passes, which the caller treats as a start failure.
 */
export function waitForVideoElement(
  ref: { current: HTMLVideoElement | null },
  maxWait = 2000,
): Promise<HTMLVideoElement | null> {
  return new Promise((resolve) => {
    // Next paint, which is when React has flushed the render.
    requestAnimationFrame(async () => {
      if (ref.current) {
        resolve(ref.current)
        return
      }
      // Yield a microtask in case the flush is still queued.
      await Promise.resolve()
      if (ref.current) {
        resolve(ref.current)
        return
      }
      // Still not mounted: poll until it appears or the budget runs out.
      const start = Date.now()
      const poll = () => {
        if (ref.current) {
          resolve(ref.current)
          return
        }
        if (Date.now() - start >= maxWait) {
          resolve(null)
          return
        }
        setTimeout(poll, 50)
      }
      setTimeout(poll, 0)
    })
  })
}
