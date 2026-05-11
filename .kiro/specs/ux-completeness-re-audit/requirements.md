# Requirements Document: UX Completeness Re-Audit

## Introduction

The Area Code platform has already undergone a written "platform completeness audit" and a "go-live ops" pass, yet a hands-on walkthrough of the production deployments at `areacode.co.za`, `business.areacode.co.za`, `staff.areacode.co.za`, and `admin.areacode.co.za` surfaced a series of serious user-experience gaps that those audits did not catch. Examples include Amplify builds silently failing for multiple consecutive commits (pnpm `ERR_PNPM_IGNORED_BUILDS`) while stale bundles continued to be served, a React hook-order bug living on master but never reaching users, check-in failures returning HTTP 422 while the client only handled a string error discriminator, 429 rate-limit responses producing no visible feedback, a "Start 14-day free trial" button that routed straight to Yoco with no trial endpoint behind it, QR posters that 404'd on the consumer web app and rotated every 15 minutes (making print runs disposable), a non-interactive "Scan the venue's QR code" hint, and a manual per-generation QR flow for businesses.

This re-audit does not replace the earlier audit document; it captures the class of requirements that, if enforced, would have surfaced those gaps before real users hit them. Every requirement in this document is written as a user-visible, externally observable outcome that can be validated against the live deployed artifacts (not against design intent, not against code on master). Pass criteria are stated in terms of concrete HTTP status codes, button states, toast copy, URL paths, served bundle hashes, Sentry events, and walkthrough steps.

## Glossary

- **Deployed_Artifact**: The exact JavaScript bundle, Lambda version, Terraform state, and DNS/CDN configuration currently being served to end users, as opposed to code on a `master` branch or a local build
- **Consumer_Web**: The deployed React application at `https://areacode.co.za`
- **Business_Web**: The deployed React application at `https://business.areacode.co.za`
- **Staff_Web**: The deployed React application at `https://staff.areacode.co.za`
- **Admin_Web**: The deployed React application at `https://admin.areacode.co.za`
- **Portal**: Any one of Consumer_Web, Business_Web, Staff_Web, or Admin_Web
- **Lambda_API**: The HTTP API implemented in AWS Lambda, fronted by API Gateway, serving all four Portals
- **API_Client**: The shared TypeScript module inside each Portal that wraps `fetch` calls to Lambda_API and is responsible for error parsing, toasting, and telemetry
- **AppError**: The backend exception class and factory methods (e.g. `AppError.notFound`, `AppError.rateLimited`, `AppError.accuracyInsufficient`) that produce structured error responses with a machine-readable `code` string and an HTTP status
- **Error_Code_Contract**: The shared, versioned list of `code` strings emitted by AppError that every API_Client switches on when rendering user-visible messages
- **Release_Hash**: The git commit SHA (short form, seven characters) embedded in the Deployed_Artifact at build time and exposed to Lambda_API responses via a response header and to each Portal via a meta tag and `/version` route
- **Deploy_Verification**: The post-deploy check that compares the Release_Hash in the Deployed_Artifact to the expected Release_Hash from the CI pipeline
- **Static_QR_Token**: A per-node QR token that does not rotate and is safe to print on physical posters for an indefinite period
- **Rotating_QR_Token**: A short-lived per-node QR token intended for in-app display only, never for print
- **QR_Scanner**: The in-app camera-based QR scanner component, built on the browser `BarcodeDetector` API with a JavaScript library fallback for browsers that lack it
- **Smoke_Suite**: The automated post-deploy test suite that executes real user journeys against the live production environment using a dedicated seeded test account
- **Walkthrough**: A manually or programmatically executed end-to-end user journey against a Deployed_Artifact, producing a pass/fail result per named acceptance criterion
- **Sentry**: The error telemetry service (or functional equivalent) capturing client and server errors with enough context to reproduce
- **Trial**: A 14-day free trial of a paid Business_Web plan, started without a payment card
- **Yoco**: The South African payment gateway used for subscription and boost purchases
- **Toast**: An ephemeral, non-blocking on-screen message rendered by the Portal's global notification component
- **Inline_Error**: An error message rendered next to the control that produced the error, persistent until the control is retried
- **Modal_Error**: A blocking dialog that requires explicit user dismissal, used only for errors that invalidate the current screen
- **Pending_State**: A visual state in which a control is disabled, shows a loading indicator, and cannot be re-triggered until the in-flight request settles
- **Critical_Journey**: One of the named end-to-end flows listed in Requirement 1

---

## Requirements

### Requirement 1: Ground-Truth Walkthrough Coverage Of Every Critical Journey

**User Story:** As the platform owner, I want every critical user journey to be walkthrough-tested against the live production deployment with named pass criteria, so that "done" means "a real user can complete the journey end-to-end on `areacode.co.za`" and not "the code is on master".

#### Acceptance Criteria

1. THE UX_Re_Audit SHALL define the following Critical_Journeys as the minimum walkthrough set: consumer sign-up with SMS OTP, consumer onboarding and archetype selection, first GPS check-in at a node, reward claim, reward redemption by staff, QR check-in from a printed poster URL, QR check-in via the in-app QR_Scanner, business sign-up and Trial activation, business node and reward creation, business QR poster generation and download, staff login and redemption validation, and admin moderation of a reported user.
2. FOR each Critical_Journey, THE UX_Re_Audit SHALL specify the start URL, the sequence of user actions, the expected HTTP status of each network call, the expected Toast or Inline_Error copy for every failure branch, and the expected final state observable in the Portal UI.
3. WHEN a Critical_Journey is executed as a Walkthrough against the Deployed_Artifact, THE UX_Re_Audit SHALL record a pass result only when every named acceptance criterion for that journey is observed in the live UI.
4. IF any Critical_Journey fails during a Walkthrough, THEN THE UX_Re_Audit SHALL block the release from being marked complete until the failure is resolved and the Walkthrough is re-executed to a pass result.
5. THE UX_Re_Audit SHALL require each Critical_Journey to be re-executed against production within 24 hours of any deployment that touches code on the journey's path.
6. WHERE a Critical_Journey has more than one valid end state (for example, check-in succeeding via GPS or falling back to QR), THE UX_Re_Audit SHALL enumerate every valid end state and require the Walkthrough to verify the correct branch for the inputs used.

### Requirement 2: Exhaustive Client Surfacing Of Server Error Responses

**User Story:** As a user of any Portal, I want every server error I can trigger to produce a visible, specific message, so that no failure is silent and no retry decision is left ambiguous.

#### Acceptance Criteria

1. FOR every user-facing endpoint on Lambda_API, THE Portal calling the endpoint SHALL render a user-visible message for each of HTTP status codes 400, 401, 403, 404, 409, 410, 422, 429, 500, and 503.
2. WHEN Lambda_API returns HTTP 429, THE Portal SHALL render a Toast containing the word "slow down" or "too many attempts" and SHALL set the originating control to a disabled state for the `Retry-After` duration returned in the response header or for 10 seconds when no header is present.
3. WHEN Lambda_API returns HTTP 422, THE Portal SHALL parse the response `code` field and SHALL render a specific message for each known `code` value listed in the Error_Code_Contract, rather than a generic "something went wrong".
4. WHEN Lambda_API returns HTTP 401 on any endpoint other than the login endpoint, THE Portal SHALL redirect the user to the login screen and SHALL render a Toast with the copy "Your session expired, please sign in again."
5. WHEN Lambda_API returns HTTP 403 on a resource the user cannot access, THE Portal SHALL render an Inline_Error next to the triggering control with the copy "You do not have permission to perform this action."
6. WHEN Lambda_API returns HTTP 404 on a navigation-level resource (for example opening a node detail page for a deleted node), THE Portal SHALL render a Modal_Error titled "Not found" and SHALL offer a single "Back" action.
7. WHEN Lambda_API returns HTTP 500 or HTTP 503, THE Portal SHALL render a Toast with the copy "Something went wrong on our side. Please try again." and SHALL retain the user's unsaved form input.
8. WHEN a network request from a Portal fails before receiving an HTTP response (offline, DNS failure, timeout), THE Portal SHALL render a Toast with the copy "Check your internet connection and try again."
9. THE UX_Re_Audit SHALL specify, for every endpoint in Lambda_API, whether each error status surfaces as a Toast, an Inline_Error, or a Modal_Error, and THE Portal SHALL render the specified surface exactly.
10. WHEN a control triggers a network request, THE Portal SHALL place the control into a Pending_State for the duration of the in-flight request and SHALL prevent re-submission until the request settles.
11. IF a user-triggered action receives any response in the set {422, 429, 500, 503} without a corresponding user-visible surface, THEN THE UX_Re_Audit SHALL treat the endpoint as failing Requirement 2 regardless of whether the underlying network call succeeded.

### Requirement 3: Deployment Reality Verification

**User Story:** As the platform owner, I want every change merged to master to be demonstrably running in production before it is counted as shipped, so that silent build failures, cached bundles, and un-deployed Lambda versions cannot hide behind a green CI badge.

#### Acceptance Criteria

1. THE CI pipeline SHALL embed the Release_Hash into every Portal build and into every Lambda_API deployment artifact.
2. THE Lambda_API SHALL return the Release_Hash in the response header `X-Release-Hash` on every response.
3. Each Portal SHALL expose the Release_Hash both in a `<meta name="x-release-hash">` tag in the HTML document and at the path `/version` as a plain-text response.
4. WHEN a deployment completes, THE Deploy_Verification step SHALL fetch the Release_Hash from the live Portal, fetch the Release_Hash from Lambda_API via `X-Release-Hash`, and SHALL compare both values to the Release_Hash produced by the CI pipeline for that deployment.
5. IF the Release_Hash served by the Deployed_Artifact does not match the CI pipeline Release_Hash within 10 minutes of deployment, THEN THE Deploy_Verification SHALL mark the deployment as failed and SHALL trigger an alert to the on-call channel.
6. WHEN a Portal deployment completes, THE Deploy_Verification SHALL issue a CloudFront or Amplify cache invalidation for the Portal's root document and its `/version` path and SHALL confirm the invalidation reached `Completed` state before marking the deployment verified.
7. WHEN a Lambda_API deployment completes, THE Deploy_Verification SHALL confirm that the Lambda function `Version` field has incremented and that the published alias points to the new version.
8. IF an Amplify build fails on two or more consecutive commits to the same branch, THEN THE Deploy_Verification SHALL trigger an alert to the on-call channel within 15 minutes of the second failure, containing the failing build log excerpt and a link to the Amplify console.
9. WHEN a pnpm install step inside Amplify emits `ERR_PNPM_IGNORED_BUILDS` or any other install-time failure, THE CI pipeline SHALL treat the build as failed regardless of downstream exit codes.
10. THE UX_Re_Audit SHALL require that every task claimed as "done" on any spec is accompanied by the Release_Hash of the deployment that made the change user-visible.

### Requirement 4: Single Source Of Truth For Error Codes

**User Story:** As an engineer, I want the backend AppError factory and every Portal's API_Client to reference the same versioned list of error codes, so that a new code cannot be emitted by the server without the client knowing how to render it.

#### Acceptance Criteria

1. THE Error_Code_Contract SHALL be defined in a single shared module imported by both the backend AppError factory and every Portal's API_Client.
2. THE Error_Code_Contract SHALL include, for every `code` value, the HTTP status code it maps to, the default user-visible copy, and the surface type (Toast, Inline_Error, or Modal_Error).
3. WHEN a new `code` value is added to the Error_Code_Contract, THE CI pipeline SHALL fail the build IF any Portal's API_Client does not handle the new `code` value in its error switch.
4. WHEN AppError emits a response with a `code` value, THE Lambda_API SHALL include that `code` in the JSON body under the field name `code`.
5. WHEN a Portal's API_Client receives a response body containing a `code` value, THE API_Client SHALL look up the Error_Code_Contract entry for that `code` and SHALL render the specified surface with the specified copy.
6. IF the API_Client receives a response with a `code` value not present in the Error_Code_Contract, THEN THE API_Client SHALL render the default message for the response's HTTP status and SHALL emit a Sentry event tagged `unknown_error_code` with the unrecognised `code` value attached.
7. THE UX_Re_Audit SHALL require a single automated test that walks every `AppError.<factory>` method and asserts the emitted `code` appears in the Error_Code_Contract.
8. WHEN the check-in endpoint emits a 422 with `code: accuracy_insufficient`, THE Consumer_Web SHALL render the QR fallback UX as specified in Requirement 6.

### Requirement 5: Permanent Printable QR Posters

**User Story:** As a business owner, I want to print a QR poster once and have it work indefinitely, so that my sunk cost on physical print runs is not invalidated by a backend token rotation.

#### Acceptance Criteria

1. THE Business_Web SHALL generate a Static_QR_Token per node that does not expire and does not rotate automatically.
2. THE printed poster URL SHALL resolve to `https://areacode.co.za/qr/{nodeId}/{staticToken}` and SHALL remain valid for an unbounded duration.
3. WHEN Lambda_API receives a check-in request carrying a Static_QR_Token, THE Lambda_API SHALL accept the token regardless of the age of the token.
4. WHERE a business explicitly invokes a "Rotate QR" action on Business_Web, THE Business_Web SHALL generate a new Static_QR_Token, invalidate the previous Static_QR_Token, and SHALL render a banner on the Business_Web node page with the copy "Your QR poster has been rotated. Reprint the poster from the Nodes page before using it again." until the user dismisses the banner.
5. WHEN a business creates a node, THE Business_Web SHALL generate the Static_QR_Token automatically without requiring the business to visit a separate Settings screen.
6. THE Business_Web node page SHALL render a "Download poster PDF" action that embeds the Static_QR_Token in a poster template ready for print.
7. WHERE the system also issues a Rotating_QR_Token for in-app display (for example on the Business_Web staff validator screen), THE Business_Web SHALL label the Rotating_QR_Token as "for screen display only" and SHALL NOT expose the Rotating_QR_Token in any print or download action.
8. IF a Rotating_QR_Token is scanned after its rotation window has elapsed, THEN THE Consumer_Web SHALL render an Inline_Error with the copy "This code has expired. Ask the venue to display a new one, or use the printed poster instead."

### Requirement 6: Universal In-App QR Scanner Coverage

**User Story:** As a consumer, business user, or staff member, I want an in-app camera scanner wherever presence verification is needed, so that I am never stranded with a code I cannot enter.

#### Acceptance Criteria

1. THE Consumer_Web SHALL provide an in-app QR_Scanner accessible from the node detail sheet when the user is outside the GPS accuracy radius.
2. THE Consumer_Web SHALL provide an in-app QR_Scanner accessible from the profile screen as a "Scan to check in" shortcut.
3. THE Staff_Web SHALL provide an in-app QR_Scanner for validating consumer Redemption_Codes presented as QR codes.
4. THE Business_Web SHALL provide an in-app QR_Scanner in the poster preview screen so that a business user can verify the printed poster resolves correctly before ordering a print run.
5. WHEN the QR_Scanner detects a QR payload matching the pattern `https://areacode.co.za/qr/{nodeId}/{token}`, THE Consumer_Web SHALL navigate to the corresponding check-in flow and SHALL pass the `nodeId` and `token` to the check-in endpoint.
6. WHEN the QR_Scanner loads on a browser that does not implement `BarcodeDetector`, THE Portal SHALL load a JavaScript QR decoder fallback library and SHALL continue scanning without user intervention.
7. IF the browser does not grant camera permission, THEN THE QR_Scanner SHALL render an Inline_Error with the copy "Camera access is needed to scan. Enable camera permission in your browser settings, or use GPS check-in instead." and SHALL expose a button that re-prompts for camera permission.
8. THE Consumer_Web SHALL handle the URL path `/qr/{nodeId}/{token}` as a first-class route that initiates the check-in flow using the supplied token, without dumping the user onto the map screen.
9. WHEN the QR_Scanner is unavailable due to missing hardware, THE Portal SHALL render an Inline_Error with a link to the GPS check-in flow and SHALL NOT leave the triggering control as non-interactive text.
10. EVERY on-screen string that refers to scanning a QR code SHALL be rendered as an interactive control that opens the QR_Scanner when activated.

### Requirement 7: Payment And Trial Integrity

**User Story:** As a business owner, I want the path from "view pricing" to "using the platform on a trial" to "paying after the trial" to be unambiguous and recoverable, so that I am never charged unexpectedly and I am never locked out without warning.

#### Acceptance Criteria

1. THE Business_Web SHALL display a pricing page that lists every plan with its monthly price, feature set, and the Trial availability per plan.
2. WHEN a business user activates a Trial, THE Business_Web SHALL start the Trial by calling a dedicated Lambda_API endpoint and SHALL NOT redirect the user to Yoco.
3. THE Lambda_API Trial activation endpoint SHALL enforce a one-Trial-per-business limit and SHALL return HTTP 409 with `code: trial_already_used` for subsequent attempts.
4. WHEN HTTP 409 with `code: trial_already_used` is returned, THE Business_Web SHALL render an Inline_Error with the copy "Your business has already used its free trial. Choose a plan to continue." and SHALL link to the pricing page.
5. WHEN a Trial has 3 days or fewer remaining, THE Business_Web SHALL render a persistent banner with the copy "Your free trial ends on {date}. Add a payment method to keep your plan active." and SHALL link to the payment setup flow.
6. WHEN a Trial expires without a payment method on file, THE Business_Web SHALL enter a 7-day grace period during which the dashboard is read-only and a Modal_Error on login prompts the user to add payment.
7. IF a Yoco payment fails, THEN THE Business_Web SHALL render a Toast with the copy "Payment failed: {reason}. You can try again from Billing." and SHALL keep the user's plan state unchanged until a successful payment is recorded.
8. WHEN a business user cancels a subscription, THE Business_Web SHALL confirm the cancellation in a Modal_Error dialog, SHALL state the effective end date, and SHALL continue to honour the plan until that end date.
9. THE Business_Web SHALL expose the current billing state (trial, active, grace, cancelled) on the account screen with a plain-text label and the next billing or expiry date.
10. THE UX_Re_Audit SHALL include a Walkthrough that starts a Trial, waits for the grace banner to appear (using a time-shift on the test account), adds a payment method, and confirms the plan transitions to `active`.

### Requirement 8: Accessibility And Resilience Floor

**User Story:** As a user on a low-end device or with assistive technology, I want every Portal to remain usable when my network is flaky, my keyboard is the only input device, or a screen reader is active, so that the platform does not silently exclude me.

#### Acceptance Criteria

1. EVERY interactive control in every Portal SHALL be reachable via keyboard Tab navigation in a logical reading order.
2. EVERY interactive control in every Portal SHALL expose an accessible name via its visible label, `aria-label`, or `aria-labelledby`.
3. WHEN a Portal detects the browser `navigator.onLine` value is `false`, THE Portal SHALL render a persistent banner with the copy "You are offline. Some actions will not work until you reconnect."
4. WHEN the Portal is offline and a user triggers a network-dependent action, THE Portal SHALL render a Toast with the copy "You are offline. Try again when you are back online." and SHALL NOT issue the network request.
5. WHEN a Portal's JavaScript bundle exceeds 1 MB gzipped, THE CI pipeline SHALL emit a warning, and WHEN a Portal's bundle exceeds 2 MB gzipped, THE CI pipeline SHALL fail.
6. WHEN a check-in completes successfully on a device that supports the Vibration API, THE Consumer_Web SHALL trigger a 30 ms haptic feedback pulse.
7. WHEN a reward is redeemed by Staff_Web on a device that supports the Vibration API, THE Staff_Web SHALL trigger a 30 ms haptic feedback pulse.
8. THE UX_Re_Audit SHALL include an automated axe-core accessibility scan on every Portal's top five screens, and the scan SHALL fail on any violation with severity `serious` or `critical`.
9. WHERE a screen requires a network request to render, THE Portal SHALL render a skeleton loading state within 100 ms of navigation and SHALL render either the content or an error state within 10 seconds or else show a retry affordance.

### Requirement 9: API-Client-Level Observability

**User Story:** As an engineer paged at 2 a.m., I want every user-visible error to have a corresponding Sentry event with enough context to reproduce, so that I never hear about a failure only from a user complaint.

#### Acceptance Criteria

1. THE API_Client in every Portal SHALL capture a Sentry event for every HTTP response with status 400 or higher and for every network-level failure.
2. THE Sentry event SHALL include the request method, request path, response status, response `code` field if present, Release_Hash, authenticated user ID if present, and a correlation ID.
3. THE Lambda_API SHALL generate a correlation ID per incoming request, SHALL return the correlation ID in the response header `X-Correlation-Id`, and SHALL include the correlation ID in every log line it emits for the request.
4. THE API_Client SHALL read `X-Correlation-Id` from every response and SHALL attach the value to the corresponding Sentry event.
5. WHEN a Toast, Inline_Error, or Modal_Error is rendered in response to a server error, THE Portal SHALL include the correlation ID in the rendered surface or in a copy-to-clipboard affordance within the surface.
6. THE API_Client SHALL attach Sentry breadcrumbs for every preceding request in the current user session so that the Sentry event shows the sequence of actions leading to the error.
7. THE UX_Re_Audit SHALL verify that no per-call-site `try/catch` block is required to produce observability, by asserting that a call site using only the API_Client's default path still emits the Sentry event and the user-visible surface.
8. WHEN a Sentry event is captured on the server side, THE Lambda_API SHALL tag the event with the Release_Hash, the Lambda function name, and the Lambda function version.

### Requirement 10: Production Smoke Suite With Authenticated Journeys

**User Story:** As the platform owner, I want an automated smoke suite that walks real user journeys against production after every deploy, so that a regression is caught by the pipeline, not by a user on the street.

#### Acceptance Criteria

1. THE Smoke_Suite SHALL run against the live production environment immediately after every deploy and SHALL run on a scheduled cadence of at most 30 minutes between runs.
2. THE Smoke_Suite SHALL execute at minimum the following journeys using a dedicated seeded test account: sign-in with the seeded consumer account, fetch nodes within a fixed bounding box, perform a simulated GPS check-in against a seeded test node, claim a seeded reward, generate a Redemption_Code, validate the Redemption_Code using a seeded staff account, start and cancel a Trial using a seeded business account, and load the admin dashboard using a seeded admin account.
3. EACH Smoke_Suite journey SHALL assert the expected HTTP status for every request in the journey and SHALL assert the expected `code` field for any expected error branch.
4. IF any Smoke_Suite journey fails, THEN THE Smoke_Suite SHALL trigger an alert to the on-call channel within 5 minutes and SHALL include the failing request, response body, and correlation ID.
5. THE Smoke_Suite SHALL include an unauthenticated health check against `/health` and an unauthenticated read against the public nodes endpoint.
6. THE Smoke_Suite SHALL use a production-isolated test tenant so that the seeded accounts do not pollute real user analytics or leaderboards.
7. THE seeded accounts SHALL be provisioned by Terraform in the `prod` environment and SHALL have credentials stored only in AWS Secrets Manager.
8. WHEN the Smoke_Suite runs, THE Smoke_Suite SHALL tag every request with the header `X-Smoke-Run` and the Lambda_API SHALL exclude any request carrying that header from business-facing analytics counters.
9. THE Smoke_Suite SHALL publish a pass/fail result per journey to CloudWatch Metrics so that dashboards and alarms can trigger on sustained failures.
10. THE UX_Re_Audit SHALL require the Smoke_Suite result for the latest deploy to be attached to any release claim before the release is counted as complete.
