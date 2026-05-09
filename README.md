# KasiEats

KasiEats is a township-focused delivery MVP for Kwamhlanga and Kwaggafontein in Kwandebele.

## What is included

- React + TypeScript frontend
- Express API for vendors, service stats, and order submission
- Local marketplace flow with basket, checkout, and rider-style delivery notes

## Run locally

```bash
npm install
npm run dev
```

The frontend runs through Vite and the API runs on `http://localhost:4000`.

## Production build

```bash
npm run build
```

## Render deploy

This project includes [`render.yaml`](./render.yaml) so it can be deployed to Render as a single Node web service that serves both the API and the built frontend.

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/CayShezi/KasiEats)

If the repository stays private, Render's GitHub app needs access to this repo before the deploy can complete.
