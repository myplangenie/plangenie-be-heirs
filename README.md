PlanGenie Backend (Express + Mongoose)

Overview
- Express API with MongoDB (Mongoose) for auth and onboarding.
- Mirrors the fields used in the current frontend forms.

Getting Started
1) Copy `.env.example` to `.env` and set values:
   - `MONGO_URI` (e.g., mongodb://localhost:27017/plangenie)
   - `JWT_SECRET` (any long random string)
   - `CORS_ORIGINS` (comma-separated list, e.g., http://localhost:3000)
   - Storage (Cloudflare R2 – S3-compatible):
     - `R2_ENDPOINT` (e.g., https://<accountid>.r2.cloudflarestorage.com)
     - `R2_BUCKET` (bucket name)
     - `R2_ACCESS_KEY_ID`
     - `R2_SECRET_ACCESS_KEY`
     - `R2_PUBLIC_BASE_URL` (public base URL for objects, e.g., https://cdn.example.com)
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
  - returns: `{ token, user }`

- GET `/api/auth/me`
  - headers: `Authorization: Bearer <token>`
  - returns: `{ user }`

User
- POST `/api/user/avatar`
  - headers: `Authorization: Bearer <token>`
  - body: `{ dataUrl: string }` where `dataUrl` is a data URI for an image (png/jpeg/webp)
  - uploads to R2 and saves `avatarUrl` on user
  - returns: `{ ok: true, url, user }`

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
