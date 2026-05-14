import compression from 'compression'
import cors from 'cors'
import express from 'express'
import rateLimit from 'express-rate-limit'
import helmet from 'helmet'
import { existsSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { authenticateOptional, issueToken, requireAuth, requireRole } from './auth.js'
import { config } from './config.js'
import { getDatabaseDiagnostics } from './db.js'
import { createCheckoutSessionForOrder, isStripeReady, verifyStripeWebhook } from './payments.js'
import { notifyOrderCreated, notifyOrderStatus, notifyPickupCreated, notifyPickupStatus } from './push.js'
import {
  attachCheckoutSession,
  createOperationalUser,
  createOrder,
  createPickupRequest,
  getAdminOverview,
  getCustomerDashboard,
  getMarketplace,
  getRiderDashboard,
  getVendorDashboard,
  logSecurityEvent,
  markCheckoutFailed,
  markCheckoutPaid,
  markOrderPaymentStatus,
  registerCustomerAccount,
  registerPushToken,
  updatePickupRequestStatus,
  updateOrderStatus,
  verifyUserCredentials,
} from './store.js'
import {
  adminCreateUserSchema,
  loginSchema,
  pickupRequestStatusSchema,
  pickupRequestSubmissionSchema,
  orderStatusSchema,
  orderSubmissionSchema,
  parseWithSchema,
  pushRegistrationSchema,
  registerCustomerSchema,
} from './validation.js'

const app = express()
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const distDir = path.resolve(__dirname, '../dist')
const distIndex = path.join(distDir, 'index.html')

function createHttpError(statusCode, message) {
  const error = new Error(message)
  error.statusCode = statusCode
  return error
}

function firstForwardedValue(value) {
  return String(Array.isArray(value) ? value[0] : value ?? '')
    .split(',')[0]
    .trim()
}

function isSameOriginRequest(origin, request) {
  try {
    const originUrl = new URL(origin)
    const host =
      firstForwardedValue(request.headers['x-forwarded-host']) || request.get('host') || ''
    const protocol =
      firstForwardedValue(request.headers['x-forwarded-proto']) || request.protocol || 'http'

    return originUrl.host === host && originUrl.protocol === `${protocol}:`
  } catch {
    return false
  }
}

function getRequestSecurityContext(request) {
  return {
    ipAddress:
      firstForwardedValue(request.headers['x-forwarded-for']) ||
      firstForwardedValue(request.headers['x-real-ip']) ||
      request.ip ||
      '',
    userAgent: String(request.get('user-agent') ?? '').slice(0, 255),
  }
}

function assertAllowedRedirectUrl(candidate, request, fieldName) {
  if (!candidate) {
    return undefined
  }

  let parsedUrl

  try {
    parsedUrl = new URL(candidate)
  } catch {
    throw createHttpError(400, `${fieldName} must be a valid URL.`)
  }

  const isAllowedOrigin =
    isSameOriginRequest(parsedUrl.origin, request) || config.allowedOrigins.includes(parsedUrl.origin)

  if (!isAllowedOrigin) {
    throw createHttpError(400, `${fieldName} must match an allowed web origin.`)
  }

  if (config.isProduction && parsedUrl.protocol !== 'https:') {
    throw createHttpError(400, `${fieldName} must use https in production.`)
  }

  return parsedUrl.toString()
}

function runInBackground(promise, label) {
  void promise.catch((error) => {
    console.error(`${label} failed`, error)
  })
}

function buildRuntimeChecks() {
  const database = getDatabaseDiagnostics()
  const checks = [
    {
      name: 'database.query',
      severity: 'error',
      ok: database.queryOk,
      message: database.queryOk ? 'SQLite query check passed.' : 'SQLite query check failed.',
    },
    {
      name: 'data.directory',
      severity: 'error',
      ok: database.directoryWritable,
      message: database.directoryWritable
        ? `Data directory is writable at ${config.dataDir}.`
        : `Data directory is not writable at ${config.dataDir}.`,
    },
    {
      name: 'database.file',
      severity: 'error',
      ok: database.databaseFileExists,
      message: database.databaseFileExists
        ? `Database file is present at ${config.databasePath}.`
        : `Database file is missing at ${config.databasePath}.`,
    },
    {
      name: 'web.origins',
      severity: 'error',
      ok: config.allowedOrigins.length > 0,
      message:
        config.allowedOrigins.length > 0
          ? `Allowed web origins configured: ${config.allowedOrigins.join(', ')}.`
          : 'No allowed web origins are configured.',
    },
    {
      name: 'payments.stripe',
      severity: 'warning',
      ok: isStripeReady(),
      message: isStripeReady()
        ? 'Stripe Checkout is configured.'
        : 'Stripe Checkout is disabled until STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET are set.',
    },
    {
      name: 'storage.persistence',
      severity: 'warning',
      ok: !(config.isProduction && database.usingDefaultDataDir),
      message:
        config.isProduction && database.usingDefaultDataDir
          ? 'Production is using the default local data directory. Attach persistent storage before scaling traffic.'
          : `Data directory is set to ${config.dataDir}.`,
    },
  ]

  return {
    ready: checks.filter((check) => check.severity === 'error').every((check) => check.ok),
    checks,
  }
}

app.disable('x-powered-by')
app.set('trust proxy', 1)
app.use((request, response, next) => {
  const requestId = randomUUID()
  const startedAt = Date.now()
  request.requestId = requestId
  response.setHeader('x-request-id', requestId)

  response.on('finish', () => {
    const duration = Date.now() - startedAt
    console.log(`[${requestId}] ${request.method} ${request.originalUrl} -> ${response.statusCode} (${duration}ms)`)
  })

  next()
})
const loginRateLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: config.loginRateLimitMax,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    message: 'Too many sign-in attempts. Please wait a moment and try again.',
  },
})
app.use(
  helmet({
    crossOriginResourcePolicy: false,
    contentSecurityPolicy: {
      directives: {
        'img-src': ["'self'", 'data:', 'https://images.unsplash.com', 'https://plus.unsplash.com'],
      },
    },
  }),
)
app.use(compression())
app.use('/api', (request, response, next) => {
  cors({
    origin(origin, callback) {
      if (!origin || isSameOriginRequest(origin, request) || config.allowedOrigins.includes(origin)) {
        callback(null, true)
        return
      }

      callback(new Error(`Origin ${origin} is not allowed.`))
    },
    credentials: true,
  })(request, response, next)
})
app.use('/api',
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: config.rateLimitMax,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      message: 'Too many requests. Please try again shortly.',
    },
  }),
)

app.post('/api/payments/stripe/webhook', express.raw({ type: 'application/json' }), async (request, response) => {
  try {
    const signature = request.headers['stripe-signature']

    if (!signature || Array.isArray(signature)) {
      throw createHttpError(400, 'Missing Stripe signature header.')
    }

    const event = verifyStripeWebhook(signature, request.body)

    if (!event) {
      response.status(503).json({
        message: 'Stripe is not configured for this environment.',
      })
      return
    }

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object

      if (session.payment_status === 'paid') {
        const order = markCheckoutPaid(session.id, session.payment_intent ? String(session.payment_intent) : null)

        if (order) {
          runInBackground(notifyOrderCreated(order), `push notifications for paid order ${order.orderId}`)
        }
      }
    } else if (event.type === 'checkout.session.expired') {
      markCheckoutFailed(event.data.object.id, 'cancelled')
    } else if (event.type === 'checkout.session.async_payment_failed') {
      markCheckoutFailed(event.data.object.id, 'failed')
    }

    response.json({ received: true })
  } catch (error) {
    const statusCode = error.statusCode ?? 400
    response.status(statusCode).json({
      message: error.message ?? 'Webhook verification failed.',
    })
  }
})

app.use(express.json({ limit: '1mb' }))

app.get('/api/health', (_request, response) => {
  const payload = {
    ok: true,
    service: 'KasiRunner API',
    timestamp: new Date().toISOString(),
  }

  response.json(
    config.isProduction
      ? payload
      : {
          ...payload,
          env: config.env,
          database: 'sqlite',
          stripeReady: isStripeReady(),
          pushProvider: 'expo',
        },
  )
})

app.get('/api/ready', (_request, response) => {
  const readiness = buildRuntimeChecks()

  response.status(readiness.ready ? 200 : 503).json({
    ok: readiness.ready,
    service: 'KasiRunner API',
    timestamp: new Date().toISOString(),
    checks: config.isProduction
      ? readiness.checks.map(({ name, severity, ok }) => ({ name, severity, ok }))
      : readiness.checks,
  })
})

app.get('/api/marketplace', (request, response) => {
  response.json(
    getMarketplace({
      zoneId: request.query.zoneId,
      search: request.query.search,
    }),
  )
})

app.get('/api/vendors', (request, response) => {
  response.json(
    getMarketplace({
      zoneId: request.query.zoneId,
      search: request.query.search,
    }).vendors,
  )
})

app.get('/api/stats', (_request, response) => {
  response.json(getMarketplace().stats)
})

app.get('/api/zones', (_request, response) => {
  response.json(getMarketplace().zones)
})

app.post('/api/auth/login', loginRateLimiter, (request, response, next) => {
  try {
    const credentials = parseWithSchema(loginSchema, request.body)
    const session = verifyUserCredentials(
      credentials.email,
      credentials.password,
      getRequestSecurityContext(request),
    )

    response.json({
      token: issueToken(session.user, { tokenVersion: session.tokenVersion }),
      user: session.user,
    })
  } catch (error) {
    next(error)
  }
})

app.post('/api/auth/register', (request, response, next) => {
  try {
    const payload = parseWithSchema(registerCustomerSchema, request.body)
    const session = registerCustomerAccount(payload, getRequestSecurityContext(request))

    response.status(201).json({
      token: issueToken(session.user, { tokenVersion: session.tokenVersion }),
      user: session.user,
    })
  } catch (error) {
    next(error)
  }
})

app.get('/api/auth/me', authenticateOptional, requireAuth, (request, response) => {
  response.json({
    user: request.user,
  })
})

app.get('/api/customer/dashboard', authenticateOptional, requireRole('customer'), (request, response) => {
  response.json(getCustomerDashboard(request.user))
})

app.get('/api/vendor/dashboard', authenticateOptional, requireRole('vendor'), (request, response) => {
  response.json(getVendorDashboard(request.user))
})

app.get('/api/rider/dashboard', authenticateOptional, requireRole('rider'), (request, response) => {
  response.json(getRiderDashboard(request.user))
})

app.get('/api/admin/overview', authenticateOptional, requireRole('admin'), (_request, response) => {
  response.json(getAdminOverview())
})

app.post('/api/admin/users', authenticateOptional, requireRole('admin'), (request, response, next) => {
  try {
    const payload = parseWithSchema(adminCreateUserSchema, request.body)
    const user = createOperationalUser(payload, request.user, getRequestSecurityContext(request))

    response.status(201).json({
      user,
    })
  } catch (error) {
    next(error)
  }
})

app.post('/api/push/register', authenticateOptional, requireAuth, (request, response, next) => {
  try {
    const payload = parseWithSchema(pushRegistrationSchema, request.body)
    registerPushToken(request.user.id, payload.token, payload.platform)

    response.status(201).json({
      ok: true,
      platform: payload.platform,
    })
  } catch (error) {
    next(error)
  }
})

app.post('/api/orders', authenticateOptional, async (request, response, next) => {
  const securityContext = getRequestSecurityContext(request)

  try {
    const payload = parseWithSchema(orderSubmissionSchema, request.body)
    const successUrl = assertAllowedRedirectUrl(payload.successUrl, request, 'successUrl')
    const cancelUrl = assertAllowedRedirectUrl(payload.cancelUrl, request, 'cancelUrl')

    if (payload.paymentMethod === 'card' && !isStripeReady()) {
      throw createHttpError(503, 'Card payments are unavailable until Stripe keys are configured.')
    }

    let order = createOrder(payload, request.user)

    if (payload.paymentMethod === 'card') {
      try {
        const checkoutSession = await createCheckoutSessionForOrder({
          request,
          order,
          successUrl,
          cancelUrl,
          customerEmail: request.user?.email ?? null,
        })

        order = {
          ...attachCheckoutSession(order.orderId, checkoutSession.id, checkoutSession.url),
          message: `Secure checkout is ready for ${order.orderId}. Complete payment to release the kitchen ticket.`,
        }
      } catch (error) {
        markOrderPaymentStatus(order.orderId, 'failed')
        throw error
      }
    } else {
      runInBackground(notifyOrderCreated(order), `push notifications for new order ${order.orderId}`)
    }

    response.status(201).json(order)
  } catch (error) {
    if (request.user && error.statusCode === 403) {
      logSecurityEvent({
        eventType: 'order.create.denied',
        userId: request.user.id,
        email: request.user.email,
        role: request.user.role,
        ipAddress: securityContext.ipAddress,
        userAgent: securityContext.userAgent,
        targetType: 'order',
        success: false,
        message: error.message ?? 'Storefront order request denied.',
      })
    }

    next(error)
  }
})

app.post('/api/pickup-requests', authenticateOptional, (request, response, next) => {
  const securityContext = getRequestSecurityContext(request)

  try {
    const payload = parseWithSchema(pickupRequestSubmissionSchema, request.body)
    const pickupRequest = createPickupRequest(payload, request.user)

    runInBackground(
      notifyPickupCreated(pickupRequest),
      `push notifications for pickup request ${pickupRequest.requestId}`,
    )

    response.status(201).json(pickupRequest)
  } catch (error) {
    if (request.user && error.statusCode === 403) {
      logSecurityEvent({
        eventType: 'pickup.create.denied',
        userId: request.user.id,
        email: request.user.email,
        role: request.user.role,
        ipAddress: securityContext.ipAddress,
        userAgent: securityContext.userAgent,
        targetType: 'pickup-request',
        success: false,
        message: error.message ?? 'Pickup request denied.',
      })
    }

    next(error)
  }
})

app.patch(
  '/api/orders/:orderId/status',
  authenticateOptional,
  requireRole('vendor', 'rider', 'admin'),
  (request, response, next) => {
    const securityContext = getRequestSecurityContext(request)

    try {
      const payload = parseWithSchema(orderStatusSchema, request.body)
      const order = updateOrderStatus(request.params.orderId, payload.status, request.user, securityContext)

      runInBackground(notifyOrderStatus(order), `push notifications for status ${order.orderId}`)

      response.json(order)
    } catch (error) {
      logSecurityEvent({
        eventType: 'order.status.denied',
        userId: request.user.id,
        email: request.user.email,
        role: request.user.role,
        ipAddress: securityContext.ipAddress,
        userAgent: securityContext.userAgent,
        targetType: 'order',
        targetId: request.params.orderId,
        success: false,
        message: error.message ?? 'Order status change denied.',
      })
      next(error)
    }
  },
)

app.patch(
  '/api/pickup-requests/:requestId/status',
  authenticateOptional,
  requireRole('rider', 'admin'),
  (request, response, next) => {
    const securityContext = getRequestSecurityContext(request)

    try {
      const payload = parseWithSchema(pickupRequestStatusSchema, request.body)
      const pickupRequest = updatePickupRequestStatus(
        request.params.requestId,
        payload.status,
        request.user,
        securityContext,
      )

      runInBackground(
        notifyPickupStatus(pickupRequest),
        `push notifications for pickup status ${pickupRequest.requestId}`,
      )

      response.json(pickupRequest)
    } catch (error) {
      logSecurityEvent({
        eventType: 'pickup.status.denied',
        userId: request.user.id,
        email: request.user.email,
        role: request.user.role,
        ipAddress: securityContext.ipAddress,
        userAgent: securityContext.userAgent,
        targetType: 'pickup-request',
        targetId: request.params.requestId,
        success: false,
        message: error.message ?? 'Pickup status change denied.',
      })
      next(error)
    }
  },
)

if (existsSync(distIndex)) {
  app.use(express.static(distDir))

  app.get(/^(?!\/api).*/, (_request, response) => {
    response.sendFile(distIndex)
  })
}

app.use((request, response) => {
  response.status(404).json({
    message: 'Route not found.',
    requestId: request.requestId ?? null,
  })
})

app.use((error, request, response, _next) => {
  const invalidJson = error instanceof SyntaxError && error.status === 400 && 'body' in error
  const statusCode = invalidJson ? 400 : (error.statusCode ?? 500)
  const message =
    invalidJson
      ? 'Request body must be valid JSON.'
      : statusCode >= 500 && config.isProduction
        ? 'Internal server error.'
        : error.message ?? 'Unknown error.'

  response.status(statusCode).json({
    message,
    requestId: request.requestId ?? null,
  })
})

app.listen(config.port, '0.0.0.0', () => {
  const readiness = buildRuntimeChecks()

  console.log(`KasiRunner API listening on http://0.0.0.0:${config.port} (${config.env})`)
  console.log(
    `Readiness: ${readiness.ready ? 'ready' : 'degraded'} | data=${config.dataDir} | origins=${config.allowedOrigins.join(', ')}`,
  )
})
