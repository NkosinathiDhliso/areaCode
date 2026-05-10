/** Minimal type declarations for Google Maps Places API used in NodeEditorPanel */
interface GoogleMapsPlaceResult {
  formatted_address?: string
  geometry?: {
    location: {
      lat: () => number
      lng: () => number
    }
  }
}

interface GoogleMapsAutocomplete {
  addListener(event: 'place_changed', handler: () => void): void
  getPlace(): GoogleMapsPlaceResult
}

interface GoogleMapsPlacesNamespace {
  Autocomplete: new (
    input: HTMLInputElement,
    options?: { componentRestrictions?: { country: string } },
  ) => GoogleMapsAutocomplete
}

interface GoogleMapsNamespace {
  maps: {
    places: GoogleMapsPlacesNamespace
  }
}

declare global {
  interface Window {
    google?: GoogleMapsNamespace
  }
}

export {}
