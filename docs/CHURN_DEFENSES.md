# Churn defences — what we built and why

Quick reference for product decisions. Pin this when designing new flows.

This doc is split into two halves because loyalty churn comes in two flavours and the defences are different:

1. **Loyalty-program design churn** — the customer disengages because the program itself feels punitive, confusing, or a worse deal than yesterday.
2. **Operational churn** — the customer disengages because the app crashes, the venue is too slow, or the moment-of-pitch never happens.

The Starbucks evidence below is documented public-record, not extrapolated from generic loyalty-industry studies.

---

## Part 1 — Starbucks-specific churn incidents

### 1.1 The 2023 redemption-price hike (loyalty design)

On 13 February 2023, Starbucks raised the cost of redemption while leaving earn rates unchanged. A free brewed coffee went from 50 to 100 stars (+100%). Handcrafted drinks went from 150 to 200 stars (+33%). Premium food rose from 200 to 300 stars (+50%).

Sources: [Washington Post (Jan 2023)](https://www.washingtonpost.com/food/2023/01/13/starbucks-rewards-changes/), [CBC (Feb 2023)](https://www.cbc.ca/lite/story/1.6741255), [Forbes (Jan 2023)](https://www.forbes.com/sites/pamdanziger/2023/01/04/starbucks-is-rewarding-customers-less-just-when-it-should-be-rewarding-them-more/), [Forrester (Feb 2023)](https://forrester.com/blogs/order-up-starbucks-rewards-changes-signal-a-renewed-focus-on-profitable-loyalty). Content rephrased for compliance with licensing restrictions.

**Behavioural-economics framing:** customers who had already accumulated 75 stars expecting a free coffee now had a half-finished progress bar. The promise of the next reward had silently moved further away. [Fortune (Jan 2023)](https://fortune.com/2023/01/25/customers-angry-starbucks-customer-loyalty-program-professors-explain-why/) covered the loss-aversion psychology in detail.

**Our exposure:** medium. We don't have a star currency, but a business owner can edit a reward (e.g. "free coffee after 5 visits" → "after 8 visits"). A user halfway to the old threshold loses ground silently.

**Defence:** grandfather any reward threshold for users already in flight. This is now a tracked spec — see `.kiro/specs/churn-defences/`.

### 1.2 The 2026 elite-tier rollout (loyalty design + communication)

On 10 March 2026, Starbucks launched three tiers: Green, Gold, Reserve. Earn rates differ by tier (Green: 1 star/$, Gold: 1.2, Reserve: 1.7). According to industry analysis ([The Points Party, Mar 2026](https://thepointsparty.com/articles/starbucks-rewards-changes-2026-elite-tiers-devaluation), [The Takeout, Mar 2026](https://www.thetakeout.com/2121799/starbucks-new-rewards-program-customer-hate/), [Daily Mail, Mar 2026](https://www.dailymail.com/yourmoney/article-15591677/starbucks-loyalty-program-money-members-rewards.html)), the average member earns 25–50% fewer stars under the new structure.

The communication failure made it worse. Forrester documented it: long-time customers who still thought of themselves as "Gold" (a tier sunset in 2019) were re-engaged through email about tier changes — and the first thing they noticed was apparent demotion. [Forrester (Mar 2026)](https://www.forrester.com/blogs/starbucks-loyalty-program-upgrade-felt-like-a-downgrade-heres-why/), [Inc (Mar 2026)](https://www.inc.com/jason-aten/starbucks-botched-the-rollout-of-its-rewards-program-and-made-everyone-mad/91315130). Content rephrased for compliance.

**Our exposure:** low — by design.

- Our tiers are visit-count thresholds (`explorer → regular → local → insider`), not annual-spend gated.
- We do not reset annually.
- We never communicate "you used to be X but now you're Y".

**Defence:** keep it that way. We should add a written commitment in our T&Cs: _tier earned is tier kept_. Tracked in the new spec.

### 1.3 The 6-month star expiration policy (loyalty design)

For years, Starbucks stars expired 6 months after the calendar month they were earned. ([HistoryTools](https://www.historytools.org/consumer/do-starbucks-stars-expire), [Tasting Table](https://www.tastingtable.com/1794066/do-starbucks-stars-expire/), [Consumer Affairs (Feb 2026)](http://www.consumeraffairs.com/news/starbucks-is-changing-its-rewards-program-heres-how-it-affects-your-free-drinks-020226.html), [Inc (Mar 2026)](https://www.inc.com/jason-aten/starbucks-finally-fixes-its-most-annoying-feature-how-to-make-sure-your-stars-never-expire-again/91294965).) Starbucks only addressed this in March 2026, and even then only Gold and Reserve members get non-expiring stars; Green members still expire after six months unless they make a qualifying purchase each month.

**Our exposure:** low. Tier and accumulated visit count never expire in our model. Individual rewards can have an expiry date set by the venue, which is correct (a "happy-hour reward" should expire). What's missing is making the distinction explicit in user-facing copy.

**Defence:** add a single line on the rewards screen: _Your tier never expires. Specific Gets may have end dates set by the venue._ Tracked.

### 1.4 Mobile-order overload broke the in-store experience (operational)

This is Starbucks's biggest _operational_ churn driver and is separate from the loyalty program. Mobile orders piled up faster than baristas could fulfil them. In-store walk-up customers found themselves behind a queue of mobile-order tickets. Loyal customers were _abandoning purchases at the till_ because of wait times — Starbucks's own CEO confirmed this on the Q2 FY2024 earnings call. [Fortune (May 2024)](https://dc.fortune.com/2024/05/01/starbucks-earnings-morning-commute-app-orders/), [Modern Retail (Sep 2024)](https://www.modernretail.co/technology/what-went-wrong-with-starbuckss-mobile-ordering-strategy/), [Business Insider (Jul 2024)](https://www.businessinsider.com/starbucks-reinvented-cafes-managment-plan-lines-waits-sales-2024-7).

By Q3 2024, marketing consultancy Technomic measured wait times of 15–30 minutes during peak hours. New CEO Brian Niccol's stated target on taking over: 30 seconds to handoff. [Fortune (Dec 2024)](https://fortune.com/2024/12/06/starbucks-ceo-brian-niccol-coffee-wait-time-30-seconds/). U.S. comparable transactions declined 8% in fiscal 2024 — that's the dollar figure on this churn driver. [SEC 8-K (Jan 2025)](https://www.sec.gov/Archives/edgar/data/829224/000082922425000013/sbux-12292024xexhibit991.htm).

**Our exposure:** different by design. We don't take orders, so we can't pile them up. The check-in itself is sub-second and doesn't bottleneck the till.

But there's a related failure mode I flagged earlier: when a queue forms, staff _will not_ pause to ask "do you have the AC app?". The pitch needs to happen _before_ the queue, or it doesn't happen.

**Defence:** in-store visual prompts (table tents, receipts, the consumer's own phone) and a GPS-proximity nudge that fires when the consumer enters venue radius. We already have GPS proximity for check-in; we just don't use it to prompt the check-in conversation. Tracked.

### 1.5 App outages and crashes (operational)

The Starbucks app has a documented history of mass-incident failures:

- 7 November 2024 — full outage during the holiday menu launch. ([Business Insider](https://www.businessinsider.com/starbucks-app-down-as-chain-launches-its-holiday-menu-2024-11)).
- 2023 — long-running "system error" account-locking bug left users with unusable gift card balances for months. ([How-To Geek](https://www.howtogeek.com/starbucks-system-error-accounts-bug/)).
- April 2026 — version 6.120.1 update caused widespread crashes and login failures. ([Multimedia Worldwide AI release-health analysis](https://mwm.ai/it/articles/starbucks-v6-120-1-triggers-widespread-crashes-and-login-failures-april-2026)).

**Our exposure:** real. Our traffic is tiny today, but a bad release at scale causes the same churn. The e2e suite I built defends against the regression class. What's missing is automatic deploy gating on crash-rate spikes.

**Defence:** Sentry release-health gate in the deploy pipeline. If the new version's crash-free user rate drops more than 1% in the first 30 minutes, auto-roll-back. We have Sentry; we just don't gate deploys on it. Tracked.

### 1.6 Loyalty members favoured over casual customers (loyalty design)

Niccol himself, on becoming CEO, said: focusing on loyalty members at the expense of infrequent customers is "never healthy" in a business. [Marketing Week (Jan 2026)](https://www.marketingweek.com/starbucks-infrequent-customers-appeal/), [Fortune (Apr 2026)](https://fortune.com/2026/04/29/starbucks-niccol-luxury-turnaround-earnings/). The previous decade of Starbucks loyalty marketing trained casual visitors to feel they were paying full price while members got the deals.

**Our exposure:** real. A first-time walk-in to a venue currently sees nothing rewarding without first signing up. That's the same wall Starbucks built.

**Defence:** a "first visit, no signup" path. Staff confirms the redemption at the till and the system mints an 8-character one-time token. The customer takes the token home (printed slip / screen photo / verbal), signs up later with email or Google, and the token is exchanged for one historical visit credit on first launch. **No PII collected at the till** — no phone, no email, no name. Tracked.

> **Note (May 2026):** the original spec used a phone-based identifier here. SMS auth was removed from the platform after pilot testing showed unreliable carrier delivery to South African networks (MTN / Vodacom OTP latency and throttling). The token model replaces it — same churn defence, less moving parts, zero SMS dependency.

---

## Part 2 — Generic loyalty-industry churn (cross-checked, not just Starbucks)

These are the broader drivers documented in the loyalty industry. They're real but they overlap heavily with the Starbucks-specific incidents above; including them here for completeness.

| Cause                                    | Industry source                                                                                                                                                  | Our defence today                                                                                                                         |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Insufficient usage / forgot the app      | RevenueCat: 37% of cancellations across all subscription apps. ([RevenueCat 2025](http://revenuecat.com/blog/growth/subscription-app-churn-reasons-how-to-fix/)) | Cohort retention dashboard ships in admin (already built). Surfaces venues whose acquired users churn within 7 days so ops can intervene. |
| ~54% of loyalty memberships sit inactive | Nector 2025 loyalty churn analytics ([source](https://www.nector.io/blog/effective-loyalty-churn-analytics))                                                     | Same cohort dashboard.                                                                                                                    |
| Difficult to use / weak rewards          | Smile.io 2025 abandonment report ([source](http://blog.smile.io/why-customers-abandon-your-loyalty-program/))                                                    | Reward metrics panel + low-performance flag in business portal (already built).                                                           |
| Staff don't pitch the app                | RestaurantBusiness on Starbucks transactions: -8% in Q4 FY2024 even with active loyalty program.                                                                 | Staff leaderboard visible to owner _and_ staff. MyRank widget on staff home (already built).                                              |
| Owners can't see ROI                     | Growave: programs disconnected from operations magnify problems. ([source](https://www.growave.io/blog/why-customer-loyalty-programs-can-backfire))              | Leaderboard's "attributed return visits" column ties each redemption to a follow-up visit within 30 days (already built).                 |
| Tier-system confusion                    | Rediem.co 2025 attrition analysis ([source](http://www.rediem.co/post/attrition-for-reward-programs))                                                            | Single tier ladder. No point currency. No expiry.                                                                                         |

---

## Part 3 — What the dashboards do, in business terms

### Admin: Retention Dashboard

A weekly cohort table showing, for users who signed up in week N, the percentage that returned for at least one further check-in within Day 1, Day 7, Day 30, and Day 90.

**Heat-map thresholds (Day 7):**

- Green ≥ 35% return rate (genuinely strong for early-stage loyalty)
- Yellow 20–35% (acceptable, monitor)
- Red < 20% (intervene)

The "top leaking venues" list ranks venues by the worst Day-7 return rate among users they acquired. A leaking venue means: they're driving signups, but those users vanish within a week. That's the signal to call the owner about reward design.

### Business: Staff Leaderboard

For each staff member: redemptions in the period, change vs previous period, unique consumers served, and **attributed return visits** (consumers who came back within 30 days of being served by that staff member).

Visible to the owner _and_ (via the MyRank widget) to staff themselves. The top 3 + "your rank" framing is intentional: full leaderboards feel like performance reviews, top-3 feels like a competition.

### Staff: My Rank widget

Top 3 performers + your own rank. Refreshes on every visit to the staff home screen. Designed for staff to glance at when starting a shift. If a staff member sees zero redemptions, the widget prompts them with the literal pitch line:

> "Pitch the app at the till today and you'll be on the board by tomorrow."

---

## Part 4 — Cost guardrails (serverless-only constraint)

- Retention dashboard caches for 30 minutes. Admins can refresh, but back-end work runs at most twice an hour.
- Leaderboard caches for 5 minutes per (businessId, period). Invalidated immediately on redemption confirm.
- Both use existing GSIs (`UserIndex` on check-ins, `BusinessIndex` on nodes). No new tables, no new GSIs.
- Worst-case retention scan capped at 5,000 most-recent users; older history comes from a daily worker (not yet implemented; tracked in the spec).

---

## Part 5 — Open product gaps (what the new spec covers)

Found while researching this doc properly:

1. **Reward-threshold grandfathering** — when a venue raises a reward threshold, freeze in-flight progress for users at the old threshold. Prevents the §1.1 "loss-aversion" failure mode.
2. **Reward expiry copy** — explicit "your tier never expires" line on the consumer rewards screen. Defends against the §1.3 perception failure.
3. **GPS-proximity check-in nudge** — when a consumer's phone enters venue radius, pre-warm a check-in prompt so the pitch happens before the queue forms. Defends against the §1.4 operational churn pattern at our scale.
4. **Sentry release-health auto-rollback** — gate deploys on crash-free-user rate, auto-roll-back on regression. Defends against the §1.5 incident class.
5. **Casual-customer first-Get path** — a first-time walk-in can claim one introductory reward by phone number alone, with full signup deferred to a follow-up visit. Defends against the §1.6 wall.
6. **T&C commitment: tier earned = tier kept** — written guarantee that tier is permanent. Defends against the §1.2 perception failure.

These are tracked in `.kiro/specs/churn-defences/`.
