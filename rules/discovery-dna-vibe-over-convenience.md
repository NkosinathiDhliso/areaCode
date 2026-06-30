---
inclusion: always
---

# Discovery DNA: vibe over convenience

This is a core product principle, not a tuning knob. Read it before touching
anything that ranks, sorts, orders, filters, scopes, recommends, or surfaces
venues to consumers — on the map, in the carousel, in search, in toasts, in
nudges, in notifications, or in any future discovery surface.

## The principle

**Area Code pulls people toward places that are alive and full of their kind of
crowd. It does not push people toward whatever is closest.**

A consumer opens the map and sees a venue pulsing, its glyph filled with people
who share their taste in music. That magnetism is the product. The job of every
discovery surface is to make that venue irresistible — even if it is a few
minutes further away than a dead spot next door.

Convenience is the enemy. If we sort by "nearest," we hand people the easy,
empty choice and the city stops coming alive. We are not Google Maps. We do not
optimise for "closest open place." We optimise for "where it is actually
happening, with people like you."

## What ranks venues (in priority order)

1. **Aliveness** — Pulse_State / Pulse_Score / Live_Check_In_Count. How buzzing
   the place is right now is the hero signal.
2. **Taste match** — archetype / music affinity between the venue's current
   crowd and the consumer. "People who like what you like are here."
3. **Proximity** — a gentle secondary nudge only. It may break ties between
   venues of comparable vibe. It must NEVER invert a clear vibe or taste winner.

A buzzing, taste-matched venue 3 km away outranks a dormant venue 200 m away.
Always. If your ranking can ever produce the opposite, it is wrong.

## Hard rules for the codebase

1. **Never make proximity the primary sort key.** No "nearest first" / "sort by
   distance" as a default discovery mode anywhere. Distance is a tiebreaker at
   most.
2. **Proximity weight stays strictly minor.** In any scoring function, the
   proximity term must be incapable of outranking a meaningfully more-alive or
   better-taste-matched venue. When in doubt, lower it, do not raise it.
3. **Lead the UI with aliveness and taste, not distance.** Cards, markers,
   headers, and announcements surface pulse state, live count, and taste cues
   (glyph, Pulse_State colour, "people who like X are here") first. Do not add
   "X km away" as the primary or most prominent venue attribute. A small,
   secondary distance hint is fine; a distance-led layout is not.
4. **Taste match is a first-class signal.** As music/archetype affinity data
   becomes available, wire it into ranking alongside buzz. Until it is wired,
   buzz leads and proximity stays minor — never let proximity fill the gap.
5. **Do not reward the easy, empty choice.** A quiet or dormant venue must not
   be promoted over a buzzing, taste-matched one just because it is closer.
   ("Be the first in" affordances are an invitation for dead venues, not a
   reason to rank them above alive ones.)
6. **Viewport scoping is allowed; convenience-ranking is not.** Scoping the
   browse strip to what is on screen keeps discovery spatially grounded — that
   is fine. Ordering what is on screen by nearness is not. Within any scope,
   order by vibe and taste.

## Why this is the DNA

- **The flywheel needs it.** Check-ins concentrated at genuinely alive venues
  make those venues read as "popping," which is the signal that pulls the next
  person in. Convenience-routing scatters check-ins across dead rooms and the
  map flatlines.
- **It is what businesses pay for.** Paying venues earn visibility by being
  alive and by matching a crowd, not by being geographically lucky. Vibe-led
  discovery is fair to them and produces the rich cross-venue and taste data
  that powers Venue Intelligence Reports.
- **It is the brand.** "The city is alive. Now you can see it." Nearest-first is
  the opposite promise.

## Known code that this rule now governs

- `apps/web/src/lib/carouselRanking.ts` — `vibeRank`. Orders venues in strict
  lexicographic priority (each level short-circuits before the next is
  consulted):
  1. **Taste-match score** (archetype match + friends-at-venue count)
  2. **Aliveness** (pulseScore + checkInCount)
  3. **Business tier / node boost** (paid lever — growth/pro get an edge among
     equally-alive venues)
  4. **Has live gets** (boolean: venue has ≥1 live event/offer)
  5. **Distance** (nearer wins, only when position is fresh)
  6. **Venue ID** (deterministic tiebreaker)

  Proximity is structurally incapable of outranking any higher signal.
  Spec: `.kiro/specs/vibe-ranked-browse/requirements.md`

- **Constellation mode (country zoom).** Below `MIN_MARKER_ZOOM`, venues
  render as pulse-driven sky beams, not hidden markers. Beam brightness =
  aliveness only; tier never brightens a quiet paid venue over an alive free
  one. Spec: `.kiro/steering/constellation-mode.md`

## The pull: answer "why go THERE, right now?"

Showing what is alive is necessary but not sufficient. Every discovery surface
must answer the question that actually gets someone off the couch: not "what is
around me" but **"why should I go THERE, right now?"** Convenience wins by
default because people over-weight the easy, near option, so the surface must
make the alive, taste-matched place feel like the bigger reward _now_.

### Magnet hierarchy (strongest pull first)

1. **Belonging** — "your crowd is here," people who share your taste. The
   strongest pull. Requires honest presence (see honest-presence rule).
2. **Momentum & anticipation** — "filling up fast," "winding down," "amapiano
   set at 21:00." A concrete reason to move now. Momentum requires departures
   (check-out / expiry); anticipation requires the venue's schedule.
3. **Aliveness** — pulse / buzz. The base signal.
4. **Raw count** — weakest on its own. Always frame it ("12 here · mostly
   amapiano"); never ship a bare number as the hero.

### Two flavours of taste-match

- **Taste-on-intent** — viewer's taste vs the venue's _declared / scheduled_
  vibe. Works on an empty map. Use it to create pull before there is a crowd.
- **Taste-on-presence** — viewer's taste vs the people _actually there now_. The
  literal "glyph full of people like you." Requires honest presence.

### Build-order implication

Honest presence first (or every claim risks being a lie), then the magnets that
work on an empty map (anticipation, taste-on-intent), then the crowd-dependent
magnets (belonging, momentum). Do not ship a crowd-dependent claim before the
presence data behind it is real.
