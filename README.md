PlanGenie Backend (Express + Mongoose)

Overview
- Express API with MongoDB (Mongoose) for auth and onboarding.
- Mirrors the fields used in the current frontend forms.
- Stripe-based monthly subscriptions with webhook handling.
- In-code entitlements for plans: Lite (free) and Premium (paid).

Getting Started
1) Copy `.env.example` to `.env` and set values:
   - `MONGO_URI` (e.g., mongodb://localhost:27017/plangenie)
   - `JWT_SECRET` (any long random string)
   - `CORS_ORIGINS` (comma-separated list, e.g., http://localhost:3000)
   - Storage (Cloudflare R2 – S3-compatible):
     - `R2_ENDPOINT` (e.g., https://<accountid>.r2.cloudflarestorage.com)
     - `R2_BUCKET` (optional; defaults to `profile-pictures` for avatars)
     - `R2_ACCESS_KEY_ID`
     - `R2_SECRET_ACCESS_KEY`
     - `R2_PUBLIC_BASE_URL` (public base URL for user avatars)
     - Optional business logos (if not set, defaults are used):
       - `R2_LOGOS_BUCKET` (defaults to `business-logos`)
       - `R2_LOGOS_PUBLIC_BASE_URL` (defaults to `https://logos.plangenie.com`)
2) Install deps and run:
   - npm install
   - npm run dev

Scripts
- `npm start` – run server.
- `npm run dev` – run with nodemon.

Endpoints

Auth
- POST `/api/auth/signup`
  - body: `{ firstName?, lastName?, fullName?, companyName?, email, password }`
  - returns: `{ ok: true }` (verification required; OTP emailed)

- POST `/api/auth/verify-otp`
  - body: `{ email, code }`
  - returns: `{ ok: true }` on successful verification

- POST `/api/auth/login`
  - body: `{ email, password }`
  - returns: `{ token, user, nextRoute, plan: { slug: 'lite'|'premium', name } }`

- GET `/api/auth/me`
  - headers: `Authorization: Bearer <token>`
  - returns: `{ user, nextRoute, plan: { slug: 'lite'|'premium', name } }`

User
- POST `/api/user/avatar`
  - headers: `Authorization: Bearer <token>`
  - body: `{ dataUrl: string }` where `dataUrl` is a data URI for an image (png/jpeg/webp)
  - uploads to R2 bucket root with filename `<timestamp>.<ext>` and saves `avatarUrl` on user
  - returns: `{ ok: true, url, user }`

Subscriptions
- POST `/api/subscriptions/checkout`
  - headers: `Authorization: Bearer <token>`
  - body (optional): `{ plan?: 'lite'|'pro', interval?: 'month'|'year', promoCode?: string, next?: string }`
  - creates a Stripe Checkout Session for the selected plan/interval; returns `{ url, sessionId }`
- POST `/api/subscriptions/portal`
  - headers: `Authorization: Bearer <token>`
  - returns a Stripe Billing Portal URL: `{ url }`
- POST `/api/subscriptions/cancel`
  - headers: `Authorization: Bearer <token>`
  - requests cancellation at period end: `{ ok: true, cancelAtPeriodEnd: true }`
- GET `/api/subscriptions/me`
  - headers: `Authorization: Bearer <token>`
  - returns `{ user: { id, hasActiveSubscription }, subscription }`
- POST `/api/subscriptions/webhook` (Stripe)
  - consumes raw JSON body for signature verification (configured in `src/app.js`).
  - handles: `checkout.session.completed`, `checkout.session.expired`, `invoice.paid`, `invoice.payment_failed`, `customer.subscription.updated/deleted`

Models
- Subscription
  - One per user; tracks `status`, Stripe IDs, period start/end, `cancelAtPeriodEnd`.
- SubscriptionHistory
  - Immutable log of events: `initialized`, `completed`, `canceled`, `payment_failed`, `activated`, `deactivated`, `updated`, `portal_opened`, `cancellation_requested`.
  - Helps audit how users attempt to subscribe.

Onboarding
All onboarding endpoints require auth header: `Authorization: Bearer <token>`

- GET `/api/onboarding`
  - returns the aggregated onboarding document for the current user

- POST `/api/onboarding/user-profile`
  - body: `{ fullName?, role?, builtPlanBefore?, planningGoal?, includePersonalPlanning? }`
  - Notes: `builtPlanBefore` and `includePersonalPlanning` accept boolean or "yes"/"no" strings

- POST `/api/onboarding/business-profile`
  - body: `{ businessName?, businessStage?, industry?, country?, city?, ventureType?, teamSize?, funding?, tools?, connectTools? }`
  - Notes: `funding` and `connectTools` accept boolean or "yes"/"no" strings; `tools` is an array of strings

- POST `/api/onboarding/vision`
  - body: `{ ubp? }` – Unique Business Proposition text

Dashboard
- GET `/api/dashboard/plan`
  - returns `{ plan: { sections: Array<{ sid, name, complete }>, companyLogoUrl: string } }`
- POST `/api/dashboard/logo`
  - headers: `Authorization: Bearer <token>`
  - body: `{ dataUrl: string }` (data URI: png/jpeg/webp up to 8MB)
  - uploads to the business logos bucket root with filename `<timestamp>.<ext>` and saves `companyLogoUrl` on the user's Plan
  - returns: `{ ok: true, url, plan }`
- GET `/api/dashboard/plan/export/pdf`
  - headers: `Authorization: Bearer <token>`
  - Generates a properly formatted PDF via Puppeteer using an EJS template (first page shows Business Name and Logo).
  - Optional query: `?refreshProse=1` to regenerate narrative sections before export.
  - streams `application/pdf` with `Content-Disposition: attachment`

Models
- User
  - `fullName, firstName, lastName, companyName, avatarUrl, email (unique), password (hashed)`
  - onboarding user fields: `role, builtPlanBefore, planningGoal, includePersonalPlanning`

- Onboarding
  - `user` (ref User, unique)
  - `userProfile` (subdocument)
  - `businessProfile` (subdocument)
  - `vision` (subdocument, currently `ubp`)

Notes
- CORS is controlled via `CORS_ORIGINS`. Add your frontend origin (e.g., http://localhost:3000).
- Passwords are hashed (bcryptjs). JWT tokens expire in 7 days.
- Stripe setup:
  - Set `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` in `.env`.
  - Provide price IDs:
    - Pro: `STRIPE_PRICE_ID_PRO_MONTH` and `STRIPE_PRICE_ID_PRO_YEAR` (falls back to `STRIPE_PRICE_ID_MONTH`/`STRIPE_PRICE_ID_YEAR` or `STRIPE_PRICE_ID`).
    - Lite: `STRIPE_PRICE_ID_LITE_MONTH` and `STRIPE_PRICE_ID_LITE_YEAR`.
  - Configure your Stripe webhook to POST to `/api/subscriptions/webhook`.
   - `APP_WEB_URL` is used for success/cancel URLs and billing portal return URL.
- Feature flags:
  - `FEATURE_JOURNEYS` (default: off) — when not set to `true`, all Journeys-related endpoints (Journeys, This Week, Assumptions, Reviews, Decisions under `/api/journeys`) are stubbed to return safe empty payloads so the frontend does not error.

OKRs and Goals (System Rules)
- Strategic hierarchy: Vision → 3–5 Year Goals → 1 Year Goals → Core OKRs → Department OKRs → Projects.
- Goals are directional; progress is automatically computed from Core OKRs (no manual status/progress updates).
- Core OKRs are derived from 1‑Year Goals and must have 2–4 Key Results. Core KR metrics are canonical (revenue, margin, churn, growth, adoption, cost) and must include a defined OKR cycle (startAt/endAt). OKR progress is computed strictly from KR metric values.
- Department OKRs must anchor to a single Core Key Result, not to a Core Objective. Each Department KR must be tagged as one of: driver | enablement | operational, and must not duplicate canonical Core metrics.
- Metric ownership rule: only Core owns canonical business metrics; departments define driver metrics (e.g., conversion rate, pipeline volume, activation, retention, cost efficiency).
- Projects track execution only. Each Core Project links to exactly one Core Key Result; each Department Project links to one Department Key Result. Project work updates KR metric fields; KR metrics compute OKR progress; OKRs compute Goal progress. There are no manual status fields for OKRs or Goals.

Plans and Entitlements
- Plan slugs: `lite` and `pro`.
- Lite removes: Financials (all endpoints), AI competitor discovery, AI customer analysis, AI-generated action plans, automatic financial linkage from Products/Services, departmental action plans, My Plan editing (view-only), multi-user collaboration.
- Lite limits: maxGoals=3, maxCoreProjects=3.
- Effective plan is derived from subscription status and plan type:
  - Only active/trialing `Pro` subscriptions set `user.hasActiveSubscription = true` (unlocks Pro features).
  - Paid `Lite` subscriptions keep `hasActiveSubscription = false` so entitlements remain Lite.
  - Enforced via middleware in `src/middleware/plan.js` and config in `src/config/entitlements.js`.
