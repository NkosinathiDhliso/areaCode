export const SA_CITIES = [
  { name: 'Cape Town', slug: 'cape-town', country: 'ZA' },
  { name: 'Johannesburg', slug: 'johannesburg', country: 'ZA' },
  { name: 'Durban', slug: 'durban', country: 'ZA' },
] as const

export type CitySlug = (typeof SA_CITIES)[number]['slug']
