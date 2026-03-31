/**
 * Overrides the browser's geolocation API to return a fixed position
 * near the centroid of the 12 JHB mock nodes.
 *
 * Patches navigator.geolocation.getCurrentPosition directly, which is
 * what platform.ts calls internally. ES module exports are read-only
 * so we can't patch the module — but patching the browser API works.
 */

const MOCK_LAT = -26.15
const MOCK_LNG = 28.04
const MOCK_ACCURACY = 15

export function patchGeolocation(): void {
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    return
  }

  navigator.geolocation.getCurrentPosition = (
    successCallback: PositionCallback,
    _errorCallback?: PositionErrorCallback | null,
    _options?: PositionOptions,
  ) => {
    const position = {
      coords: {
        latitude: MOCK_LAT,
        longitude: MOCK_LNG,
        accuracy: MOCK_ACCURACY,
        altitude: null,
        altitudeAccuracy: null,
        heading: null,
        speed: null,
      },
      timestamp: Date.now(),
    } as GeolocationPosition
    successCallback(position)
  }
}
