import compression from 'compression'
import cors from 'cors'
import express from 'express'
import rateLimit from 'express-rate-limit'
import helmet from 'helmet'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { authenticateOptional, issueToken, requireAuth, requireRole } from './auth.js'
import { config } from './config.js'
import { createCheckoutSessionForOrder, isStripeReady, verifyStripeWebhook } from './payments.js'
import { notifyOrderCreated, notifyOrderStatus } from './push.js'
import {
  attachCheckoutSession,
  createOrder,
  getAdminOverview,
  getCustomerDashboard,
  getMarketplace,
  getRiderDashboard,
  getVendorDashboard,
  markCheckoutFailed,
  markCheckoutPaid,
  markOrderPaymentStatus,
  registerPushToken,
  updateOrderStatus,
  verifyUserCredentials,
} from './store.js'
import {
  loginSchema,
  orderStatusSchema,
  orderSubmissionSchema,
  parseWithSchema,
  pushRegistrationSchema,
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

function runInBackground(promise, label) {
  void promise.catch((error) => {
    console.error(`${label} failed`, error)
  })
}

app.disable('x-powered-by')
app.set('trust proxy', 1)
app.use(helmet({ crossOriginResourcePolicy: false }))
app.use(compression())
app.use('/api', (request, response, next) => {
  cors({
    origin(origin, callback) {
      if (
        !origin ||
        isSameOriginRequest(origin, request) ||
        config.allowedOrigins.length === 0 ||
        config.allowedOrigins.includes(origin)
      ) {
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
app.use((request, response, next) => {
  const startedAt = Date.now()

  response.on('finish', () => {
    const duration = Date.now() - startedAt
    console.log(`${request.method} ${request.originalUrl} -> ${response.statusCode} (${duration}ms)`)
  })

  next()
})

app.get('/api/health', (_request, response) => {
  response.json({
    ok: true,
    env: config.env,
    service: 'KasiEats API',
    database: 'sqlite',
    stripeReady: isStripeReady(),
    pushProvider: 'expo',
    timestamp: new Date().toISOString(),
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

app.post('/api/auth/login', (request, response, next) => {
  try {
    const credentials = parseWithSchema(loginSchema, request.body)
    const user = verifyUserCredentials(credentials.email, credentials.password)

    response.json({
      token: issueToken(user),
      user,
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
  try {
    const payload = parseWithSchema(orderSubmissionSchema, request.body)

    if (payload.paymentMethod === 'card' && !isStripeReady()) {
      throw createHttpError(503, 'Card payments are unavailable until Stripe keys are configured.')
    }

    let order = createOrder(payload, request.user)

    if (payload.paymentMethod === 'card') {
      try {
        const checkoutSession = await createCheckoutSessionForOrder({
          request,
          order,
          successUrl: payload.successUrl,
          cancelUrl: payload.cancelUrl,
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
    next(error)
  }
})

app.patch(
  '/api/orders/:orderId/status',
  authenticateOptional,
  requireRole('vendor', 'rider', 'admin'),
  (request, response, next) => {
    try {
      const payload = parseWithSchema(orderStatusSchema, request.body)
      const order = updateOrderStatus(request.params.orderId, payload.status, request.user)

      runInBackground(notifyOrderStatus(order), `push notifications for status ${order.orderId}`)

      response.json(order)
    } catch (error) {
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

app.use((_request, response) => {
  response.status(404).json({
    message: 'Route not found.',
  })
})

app.use((error, _request, response, _next) => {
  const statusCode = error.statusCode ?? 500
  const message =
    statusCode >= 500 && config.isProduction ? 'Internal server error.' : error.message ?? 'Unknown error.'

  response.status(statusCode).json({
    message,
  })
})

app.listen(config.port, '0.0.0.0', () => {
  console.log(`KasiEats API listening on http://0.0.0.0:${config.port}`)
})
