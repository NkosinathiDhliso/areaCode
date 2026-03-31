import type { MusicGenre, PersonalityDimension, GenreWeightEntry } from '../types'

export const MUSIC_GENRES: MusicGenre[] = [
  'amapiano',
  'deep_house',
  'afrobeats',
  'hip_hop',
  'rnb',
  'kwaito',
  'gqom',
  'jazz',
  'rock',
  'pop',
  'gospel',
  'maskandi',
]

export const PERSONALITY_DIMENSIONS: PersonalityDimension[] = [
  'energy',
  'cultural_rootedness',
  'sophistication',
  'edge',
  'spirituality',
]

export const GENRE_WEIGHT_MATRIX: GenreWeightEntry[] = [
  {
    genre: 'amapiano',
    weights: { energy: 0.9, cultural_rootedness: 0.6, sophistication: 0.3, edge: 0.2, spirituality: 0.1 },
  },
  {
    genre: 'deep_house',
    weights: { energy: 0.5, cultural_rootedness: 0.2, sophistication: 0.8, edge: 0.1, spirituality: 0.3 },
  },
  {
    genre: 'afrobeats',
    weights: { energy: 0.8, cultural_rootedness: 0.7, sophistication: 0.3, edge: 0.3, spirituality: 0.2 },
  },
  {
    genre: 'hip_hop',
    weights: { energy: 0.6, cultural_rootedness: 0.4, sophistication: 0.4, edge: 0.8, spirituality: 0.2 },
  },
  {
    genre: 'rnb',
    weights: { energy: 0.4, cultural_rootedness: 0.3, sophistication: 0.8, edge: 0.2, spirituality: 0.4 },
  },
  {
    genre: 'kwaito',
    weights: { energy: 0.7, cultural_rootedness: 0.9, sophistication: 0.2, edge: 0.5, spirituality: 0.3 },
  },
  {
    genre: 'gqom',
    weights: { energy: 0.9, cultural_rootedness: 0.5, sophistication: 0.1, edge: 0.8, spirituality: 0.1 },
  },
  {
    genre: 'jazz',
    weights: { energy: 0.3, cultural_rootedness: 0.3, sophistication: 0.9, edge: 0.2, spirituality: 0.7 },
  },
  {
    genre: 'rock',
    weights: { energy: 0.8, cultural_rootedness: 0.1, sophistication: 0.2, edge: 0.9, spirituality: 0.1 },
  },
  {
    genre: 'pop',
    weights: { energy: 0.6, cultural_rootedness: 0.2, sophistication: 0.4, edge: 0.3, spirituality: 0.2 },
  },
  {
    genre: 'gospel',
    weights: { energy: 0.4, cultural_rootedness: 0.7, sophistication: 0.4, edge: 0.1, spirituality: 0.9 },
  },
  {
    genre: 'maskandi',
    weights: { energy: 0.5, cultural_rootedness: 0.9, sophistication: 0.3, edge: 0.3, spirituality: 0.6 },
  },
]
