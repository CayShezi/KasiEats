import path from 'node:path'

function readPositiveNumber(name, fallback) {
  const value = Number(process.env[name] ?? fallback)

  if (Number.isNaN(value) || value <= 0) {
    throw new Error(`${name} must be a positive number.`)
  }

  return value
}

function normalizeOrigins(rawOrigins) {
  const uniqueOrigins = new Set()

  rawOrigins
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
    .forEach((value) => {
      let origin

      try {
        origin = new URL(value).origin
      } catch {
        throw new Error(`WEB_ORIGIN contains an invalid URL: ${value}`)
      }

      uniqueOrigins.add(origin)
    })

  return [...uniqueOrigins]
}

const env = process.env.NODE_ENV ?? 'development'
const isProduction = env === 'production'
const port = readPositiveNumber('PORT', 4000)
const defaultOrigins = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'https://kasieats.onrender.com',
  'https://kasirunner.onrender.com',
]
const rawOrigins = process.env.WEB_ORIGIN ?? defaultOrigins.join(',')
const dataDir = path.resolve(process.cwd(), process.env.DATA_DIR ?? './data')
const databasePath = path.resolve(dataDir, process.env.DATABASE_FILENAME ?? 'kasieats.sqlite')
const allowedOrigins = normalizeOrigins(rawOrigins)

if (isProduction && !process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET is required when NODE_ENV=production.')
}

if (isProduction && allowedOrigins.length === 0) {
  throw new Error('WEB_ORIGIN must include at least one allowed origin in production.')
}

export const config = {
  env,
  isProduction,
  port,
  dataDir,
  databasePath,
  jwtSecret: process.env.JWT_SECRET ?? 'development-only-secret',
  jwtIssuer: process.env.JWT_ISSUER ?? 'kasirunner-api',
  jwtAudience: process.env.JWT_AUDIENCE ?? 'kasirunner-app',
  customerTokenTtl: process.env.JWT_TTL_CUSTOMER ?? '6h',
  vendorTokenTtl: process.env.JWT_TTL_VENDOR ?? '2h',
  riderTokenTtl: process.env.JWT_TTL_RIDER ?? '2h',
  adminTokenTtl: process.env.JWT_TTL_ADMIN ?? '45m',
  rateLimitMax: readPositiveNumber('RATE_LIMIT_MAX', 120),
  loginRateLimitMax: readPositiveNumber('LOGIN_RATE_LIMIT_MAX', 8),
  loginMaxAttempts: readPositiveNumber('LOGIN_MAX_ATTEMPTS', 5),
  loginLockMinutes: readPositiveNumber('LOGIN_LOCK_MINUTES', 15),
  pushRequestTimeoutMs: readPositiveNumber('PUSH_REQUEST_TIMEOUT_MS', 8000),
  stripeSecretKey: process.env.STRIPE_SECRET_KEY ?? '',
  stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET ?? '',
  allowedOrigins,
}
