import type { Reward } from '../../types'
import { hoursAgo, daysFromNow } from '../helpers'

export const MOCK_REWARDS: Reward[] = [
  // Nando's Rosebank — food (mock-node-1)
  { id: 'mock-reward-1', nodeId: 'mock-node-1', type: 'nth_checkin', title: 'Free starter with any main',
    description: 'Get a free starter when you order any main course', triggerValue: 5,
    totalSlots: 50, claimedCount: 48, slotsLocked: true, isActive: true,
    expiresAt: daysFromNow(3), createdAt: hoursAgo(24 * 7) },
  { id: 'mock-reward-2', nodeId: 'mock-node-1', type: 'daily_first', title: 'Free peri-peri sauce bottle',
    description: 'First 10 check-ins today get a free sauce bottle', triggerValue: 10,
    totalSlots: 10, claimedCount: 7, slotsLocked: true, isActive: true,
    expiresAt: daysFromNow(1), createdAt: hoursAgo(12) },
  // Father Coffee (mock-node-2)
  { id: 'mock-reward-3', nodeId: 'mock-node-2', type: 'daily_first', title: 'Free coffee with any breakfast',
    description: 'First check-in of the day earns a free filter coffee', triggerValue: 1,
    totalSlots: 100, claimedCount: 12, slotsLocked: true, isActive: true,
    expiresAt: daysFromNow(14), createdAt: hoursAgo(24 * 10) },
  { id: 'mock-reward-4', nodeId: 'mock-node-2', type: 'streak', title: '50% off pastry',
    description: 'Check in 3 days in a row for half-price pastry', triggerValue: 3,
    totalSlots: null, claimedCount: 12, slotsLocked: false, isActive: true,
    expiresAt: null, createdAt: hoursAgo(24 * 5) },
  // Kitchener's Bar (mock-node-3)
  { id: 'mock-reward-5', nodeId: 'mock-node-3', type: 'nth_checkin', title: '20% off cocktails before 8pm',
    description: 'Show this reward for 20% off any cocktail', triggerValue: 2,
    totalSlots: 30, claimedCount: 28, slotsLocked: true, isActive: true,
    expiresAt: daysFromNow(2), createdAt: hoursAgo(24 * 3) },
  { id: 'mock-reward-6', nodeId: 'mock-node-3', type: 'milestone', title: 'Free round for the table',
    description: 'When the venue hits 100 check-ins today', triggerValue: 100,
    totalSlots: 5, claimedCount: 0, slotsLocked: true, isActive: true,
    expiresAt: daysFromNow(7), createdAt: hoursAgo(24 * 2) },
  // Neighbourgoods Market (mock-node-4)
  { id: 'mock-reward-7', nodeId: 'mock-node-4', type: 'daily_first', title: 'Free artisan bread loaf',
    description: 'First 5 visitors today get a free loaf', triggerValue: 5,
    totalSlots: 5, claimedCount: 3, slotsLocked: true, isActive: true,
    expiresAt: daysFromNow(1), createdAt: hoursAgo(6) },
  // Virgin Active Sandton (mock-node-5)
  { id: 'mock-reward-8', nodeId: 'mock-node-5', type: 'milestone', title: 'Free day pass',
    description: 'Reach 20 total check-ins for a free day pass', triggerValue: 20,
    totalSlots: 20, claimedCount: 4, slotsLocked: true, isActive: true,
    expiresAt: daysFromNow(30), createdAt: hoursAgo(24 * 14) },
  // Arts on Main (mock-node-6)
  { id: 'mock-reward-9', nodeId: 'mock-node-6', type: 'daily_first', title: 'Free gallery tour',
    description: 'First check-in of the day earns a free guided gallery tour', triggerValue: 1,
    totalSlots: 15, claimedCount: 8, slotsLocked: true, isActive: true,
    expiresAt: null, createdAt: hoursAgo(24 * 20) },
  // Sandton City (mock-node-7)
  { id: 'mock-reward-10', nodeId: 'mock-node-7', type: 'nth_checkin', title: '10% off any purchase',
    description: 'Your 3rd visit earns 10% off at any Sandton City store', triggerValue: 3,
    totalSlots: 20, claimedCount: 15, slotsLocked: true, isActive: true,
    expiresAt: daysFromNow(1), createdAt: hoursAgo(8) },
  // Doubleshot Coffee (mock-node-8)
  { id: 'mock-reward-11', nodeId: 'mock-node-8', type: 'daily_first', title: 'Buy 1 get 1 free smoothie',
    description: 'First check-in of the day earns a free smoothie with any purchase', triggerValue: 1,
    totalSlots: 40, claimedCount: 10, slotsLocked: true, isActive: true,
    expiresAt: daysFromNow(21), createdAt: hoursAgo(24 * 8) },
  // The Grillhouse (mock-node-9)
  { id: 'mock-reward-12', nodeId: 'mock-node-9', type: 'streak', title: 'R50 off your next meal',
    description: 'Check in 3 days in a row for R50 off', triggerValue: 3,
    totalSlots: 25, claimedCount: 22, slotsLocked: true, isActive: true,
    expiresAt: daysFromNow(5), createdAt: hoursAgo(24 * 6) },
  // Taboo Nightclub (mock-node-10)
  { id: 'mock-reward-13', nodeId: 'mock-node-10', type: 'daily_first', title: 'Free entry before 10pm',
    description: 'First check-in of the day earns free entry before 10pm', triggerValue: 1,
    totalSlots: 10, claimedCount: 10, slotsLocked: true, isActive: false,
    expiresAt: hoursAgo(2), createdAt: hoursAgo(24) },
  // Keyes Art Mile (mock-node-11)
  { id: 'mock-reward-14', nodeId: 'mock-node-11', type: 'streak', title: 'Free workshop session',
    description: '7-day streak earns a free art workshop', triggerValue: 7,
    totalSlots: 8, claimedCount: 2, slotsLocked: true, isActive: true,
    expiresAt: daysFromNow(14), createdAt: hoursAgo(24 * 12) },
  // Planet Fitness Melrose (mock-node-12)
  { id: 'mock-reward-15', nodeId: 'mock-node-12', type: 'milestone', title: 'Free yoga class',
    description: 'Reach 10 total check-ins for a free yoga class', triggerValue: 10,
    totalSlots: 15, claimedCount: 6, slotsLocked: true, isActive: true,
    expiresAt: daysFromNow(1), createdAt: hoursAgo(4) },
  // Extra rewards for variety
  { id: 'mock-reward-16', nodeId: 'mock-node-4', type: 'nth_checkin', title: 'Free coffee from any stall',
    description: 'Your 5th visit earns a free coffee', triggerValue: 5,
    totalSlots: null, claimedCount: 18, slotsLocked: false, isActive: true,
    expiresAt: null, createdAt: hoursAgo(24 * 15) },
  { id: 'mock-reward-17', nodeId: 'mock-node-5', type: 'streak', title: 'Free personal training session',
    description: '10-day streak earns a free PT session', triggerValue: 10,
    totalSlots: 3, claimedCount: 3, slotsLocked: true, isActive: false,
    expiresAt: hoursAgo(48), createdAt: hoursAgo(24 * 30) },
]
