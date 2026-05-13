# KasiRunner

KasiRunner is a township-focused delivery and driver-pickup platform for Kwamhlanga and Kwaggafontein in Kwandebele. This repo now includes a stronger production foundation:

- A secured Express API with role-based access for `customer`, `vendor`, `rider`, and `admin`
- A file-backed SQLite datastore for users, vendors, menu items, orders, pickup requests, and push-token registrations
- Stripe Checkout integration for card payments
- Expo push notification registration and server-side dispatch hooks
- A React + TypeScript web storefront and operations console
- An Expo mobile app in [`mobile/`](./mobile) for customer ordering, pickup requests, and operational visibility

## Demo roles

Use these seeded demo accounts in the web app and mobile app:

- `customer@kasieats.demo` / `Welcome123!`
- `vendor@kasieats.demo` / `Welcome123!`
- `rider@kasieats.demo` / `Welcome123!`
- `admin@kasieats.demo` / `Welcome123!`

## Web and API setup

```bash
npm install
npm run dev
```

The web app runs on `http://localhost:5173` and the API runs on `http://localhost:4000`.

Optional environment variables live in [`.env.example`](./.env.example).

Important variables:

- `DATA_DIR` and `DATABASE_FILENAME` control where the SQLite database file is stored
- `STRIPE_SECRET_KEY` enables hosted card checkout
- `STRIPE_WEBHOOK_SECRET` verifies Stripe webhook events before marking orders as paid

Without Stripe keys, cash and eWallet flows still work, but card checkout correctly returns `503`.

## Mobile app setup

```bash
npm run mobile:start
```

The Expo app lives in [`mobile/`](./mobile). Set `EXPO_PUBLIC_API_BASE_URL` in [`mobile/.env.example`](./mobile/.env.example) when you want the mobile client to talk to a deployed API instead of its local demo fallback.

For mobile push notifications, also set:

- `EXPO_PUBLIC_WEB_URL` so hosted Stripe checkout can return to your deployed web app
- `EXPO_PUBLIC_EXPO_PROJECT_ID` so the mobile app can request an Expo push token

Push registration is intended for a physical device or a supported development build.

## Verification

```bash
npm run check
```

This runs web linting, the production web build, and a TypeScript check for the Expo mobile app.

## Render deploy

This project includes [`render.yaml`](./render.yaml) so Render can deploy the web app and API together as a single Node service.

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/CayShezi/KasiRunner)

Render blueprint notes:

- `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` are declared with `sync: false`, so Render prompts for them during the initial Blueprint setup
- `DATA_DIR` points at `/opt/render/project/src/storage`
- For real persistence on Render, attach a persistent disk to the service or move the app to a managed database
- Stripe webhook target on Render should point to `/api/payments/stripe/webhook`

Render docs used for this setup:

- [Blueprint YAML Reference](https://render.com/docs/blueprint-spec)
- [Deploy to Render Button](https://render.com/docs/deploy-to-render)
- [Persistent Disks](https://render.com/docs/disks)

Stripe and Expo docs used for this setup:

- [Stripe Checkout Sessions API](https://docs.stripe.com/payments/checkout-sessions)
- [Stripe Checkout Sessions API Reference](https://docs.stripe.com/api/checkout/sessions)
- [Expo push notifications setup](https://docs.expo.dev/push-notifications/push-notifications-setup/)
- [Expo push notifications sending guide](https://docs.expo.dev/push-notifications/sending-notifications/)

## Honest production note

This repo now has a stronger production-ready foundation for auth, roles, validation, SQLite persistence, Stripe-hosted card checkout, and Expo push delivery. The next step after this is operational hardening: managed secrets, a persistent Render disk or managed database, real payment reconciliation, and push credentials configured through Expo/EAS for the final mobile builds.
