import path from 'node:path'

const env = process.env.NODE_ENV ?? 'development'
const isProduction = env === 'production'
const port = Number(process.env.PORT ?? 4000)
const rawOrigins = process.env.WEB_ORIGIN ?? 'http://localhost:5173'
const dataDir = path.resolve(process.cwd(), process.env.DATA_DIR ?? './data')
const databasePath = path.resolve(dataDir, process.env.DATABASE_FILENAME ?? 'kasieats.sqlite')

if (Number.isNaN(port)) {
  throw new Error('PORT must be a valid number.')
}

if (isProduction && !process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET is required when NODE_ENV=production.')
}

export const config = {
  env,
  isProduction,
  port,
  dataDir,
  databasePath,
  jwtSecret: process.env.JWT_SECRET ?? 'development-only-secret',
  rateLimitMax: Number(process.env.RATE_LIMIT_MAX ?? 120),
  stripeSecretKey: process.env.STRIPE_SECRET_KEY ?? '',
  stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET ?? '',
  allowedOrigins: rawOrigins
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean),
}
