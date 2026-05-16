# Area Code — Pilot Launch Checklist

5–10 venues, single neighbourhood, Johannesburg. Tighten the loop before going wider.

> **Hard rule:** if any item in §1 fails, the launch is paused. Everything else is recoverable.

---

## §1 — The four launch-day blockers

These are the things that, if broken on the first day, kill the pilot.

| #   | Test                                                                          | Pass condition                                                                       | Fix path                                                                                                                                         |
| --- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | **First QR scan succeeds end-to-end on a real venue staff phone.**            | Staff sees redemption preview within 2 seconds; confirms; sees "Redeemed!"           | Test once per venue, on the actual phone. Switch to manual code entry if camera permission is denied.                                            |
| 2   | **First customer signup from the venue completes via Google OAuth or email.** | New user lands on the map within 8 seconds of signup.                                | Email branch is the fallback. Both should be tested live before opening the door.                                                                |
| 3   | **Yoco webhook upgrades the venue from trial to paid.**                       | After test card payment, the dashboard shows "Pro · paid until …" within 60 seconds. | Use Yoco's test mode card `4242 4242 4242 4242`. Verify the webhook URL in Yoco dashboard matches `https://api.areacode.co.za/v1/webhooks/yoco`. |
| 4   | **Map loads on the lowest-spec phone we plan to support.**                    | A 2019 Android with 4G shows the map and at least one node within 10 seconds.        | If WebGL isn't available, the fallback should still render markers in 2D mode.                                                                   |

**If all four pass, you can open signups. If even one fails, fix before the first customer walks in.**

---

## §2 — Backend ready check

Run before the launch day, repeat the morning of.

- [ ] `curl https://api.areacode.co.za/health` returns `{"status":"ok","env":"prod"}`
- [ ] `curl https://api.areacode.co.za/v1/nodes/johannesburg` returns at least 5 nodes
- [ ] All seeded venues have `isActive: true` (verify in admin → Node Management)
- [ ] All seeded venues have lat/lng populated and within Johannesburg bounding box
- [ ] All seeded venues have at least one active reward
- [ ] At least one venue has `isFirstGet=true` set on a reward (this is the casual-customer path)
- [ ] Cognito consumer pool has password policy ≥ 8 chars, no MFA required at signup
- [ ] Cognito consumer pool has Google identity provider configured
- [ ] Sentry release is recorded for the live SHA (check the release-health-gate workflow ran clean)
- [ ] Last `release-health-gate.yml` run shows `rollback=false`
- [ ] No outstanding alerts in Sentry, no DLQ messages in `area-code-prod-reward-eval-dlq` or `area-code-prod-push-sender-dlq`
- [ ] Last 24h of CloudWatch logs show no `level=ERROR` lines on the API Lambda

## §3 — Frontend ready check

- [ ] `https://areacode.co.za` loads with map visible
- [ ] `https://business.areacode.co.za` loads to the login screen
- [ ] `https://staff.areacode.co.za` loads to the login screen
- [ ] `https://admin.areacode.co.za` loads to the login screen
- [ ] All four respond < 3s on first load over LTE
- [ ] No console errors in DevTools on initial load
- [ ] HTTPS is enforced (test with `http://areacode.co.za` → expect a 30x to https)

## §4 — Per-venue pre-launch (run for each pilot venue)

For each venue:

- [ ] Owner has signed up to the business portal and added their venue
- [ ] Venue address geocodes correctly (verify on consumer map)
- [ ] Venue has uploaded a header image
- [ ] At least one reward configured, with thresholds the founder approves
- [ ] **One reward marked as the venue's First-Get** (essential for casual-customer flow)
- [ ] Owner has invited at least one staff member; staff has accepted invite
- [ ] Staff has logged into staff app on their work phone successfully
- [ ] Staff has done one **dummy redemption** to confirm the QR flow works
- [ ] Staff has issued one **dummy First-Get token** to confirm the issuer card renders and prints
- [ ] QR poster printed and visible at the till
- [ ] Owner has been briefed using `docs/PILOT_BRIEFING.md` (sent + read confirmed)
- [ ] Owner has the founder's WhatsApp saved as a contact

## §5 — Launch-day operations (the morning the venue opens with the app)

- [ ] Founder is reachable on WhatsApp from 7am to 7pm
- [ ] Sentry alerts are routed to founder's phone
- [ ] CloudWatch dashboard pinned in a browser tab
- [ ] Admin retention dashboard refreshed every 2 hours, manually
- [ ] At noon, founder messages each pilot owner: "How's it going?" — open-ended, asks for problems
- [ ] At 6pm, founder reviews the day's signup numbers per venue. Anything below 3 signups gets a follow-up call

## §6 — Day 7 review (the most important checkpoint)

This is where you decide if the model works.

For each pilot venue, check the admin Retention Dashboard:

- [ ] **Signups in the first 7 days** ≥ 20 per venue (target: 30+)
- [ ] **Day 7 return rate** ≥ 20% (target: 35%)
- [ ] **Top-leaking venues list** doesn't include this venue at the top

For the staff leaderboard at each venue:

- [ ] Top staff member has at least 5 redemptions
- [ ] At least 50% of staff have ≥ 1 redemption

If you're hitting all six, expand to 50 venues across Johannesburg + Cape Town in week 3. If you're below on more than two, **don't expand** — diagnose first.

## §7 — Day 30 review

- [ ] **Day 30 return rate** ≥ 15% across the cohort
- [ ] **Yoco conversion rate** (trial → paid) ≥ 30% (3 of 10 venues stay paid)
- [ ] **Per-venue pulse score** climbed from week 1 to week 4 at most venues
- [ ] **Daily check-ins per venue** averaged ≥ 5 in week 4
- [ ] **Founder time per venue** spent on support is decreasing week-over-week

If 30-day retention is below 15%, the reward design is wrong, not the platform. Workshop reward design with the venues that have the worst numbers.

## §8 — Things that will go wrong (and what to do)

| Symptom                                                | Most likely cause                     | First thing to check                                                                                                                                          |
| ------------------------------------------------------ | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Customer says "I tapped check-in but nothing happened" | GPS accuracy too low (common indoors) | Ask them to step outside the venue and try again. If still failing, fall back to QR.                                                                          |
| Staff says "the QR scanner is black"                   | Camera permission not granted         | Browser settings → site permissions → camera → allow. Re-test.                                                                                                |
| Owner says "no one is signing up"                      | Staff not pitching                    | Sit at the venue for 30 minutes. Watch what staff actually says. Briefing fix.                                                                                |
| Owner says "the dashboard is broken"                   | Stale token / cookies                 | Hard refresh (Ctrl+Shift+R) or sign out and back in.                                                                                                          |
| Sentry alert: "5xx error rate spike"                   | Almost certainly a recent deploy      | Run `release-health-gate.yml` with current SHA. If `rollback=true`, the gate already rolled back; check the alert. If `rollback=false`, investigate manually. |
| Yoco webhook didn't fire                               | Webhook signature mismatch            | Verify `YOCO_WEBHOOK_SECRET` env var matches Yoco dashboard. Re-trigger from dashboard.                                                                       |

## §9 — Out-of-scope for the pilot

These are deliberately not validated during this pilot:

- Push notifications at scale (we test on a few devices, not hundreds)
- WebSocket reconnection under network flapping at scale
- Cross-venue patterns (need ≥ 50 venues to be meaningful)
- Multi-city signals (need ≥ 2 cities to be meaningful)

If something on this list breaks during the pilot, it's a bug; fix it. But we don't measure performance on these dimensions until the pilot proves the core loop.

---

## Sign-off

| Role                    | Name | Date | Signature |
| ----------------------- | ---- | ---- | --------- |
| Founder                 |      |      |           |
| Engineering             |      |      |           |
| First pilot venue owner |      |      |           |
