import Stripe from 'stripe'
import { config } from './config.js'

const stripe = config.stripeSecretKey
  ? new Stripe(config.stripeSecretKey, {
      appInfo: {
        name: 'KasiEats',
        version: '1.0.0',
      },
    })
  : null

function normalizeOrigin(value) {
  return String(value ?? '').replace(/\/$/, '')
}

function buildBaseUrl(request) {
  const forwardedProto = request.headers['x-forwarded-proto']
  const protocol = String(Array.isArray(forwardedProto) ? forwardedProto[0] : forwardedProto || request.protocol)
  return `${protocol}://${request.get('host')}`
}

function buildReturnUrl(candidate, fallback, orderId) {
  if (candidate) {
    return candidate
  }

  return `${normalizeOrigin(fallback)}/?payment=success&orderId=${encodeURIComponent(orderId)}`
}

function buildCancelUrl(candidate, fallback, orderId) {
  if (candidate) {
    return candidate
  }

  return `${normalizeOrigin(fallback)}/?payment=cancel&orderId=${encodeURIComponent(orderId)}`
}

export function isStripeReady() {
  return Boolean(stripe)
}

export function verifyStripeWebhook(signature, body) {
  if (!stripe) {
    return null
  }

  if (!config.stripeWebhookSecret) {
    throw new Error('STRIPE_WEBHOOK_SECRET is not configured.')
  }

  return stripe.webhooks.constructEvent(body, signature, config.stripeWebhookSecret)
}

export async function createCheckoutSessionForOrder({
  request,
  order,
  successUrl,
  cancelUrl,
  customerEmail,
}) {
  if (!stripe) {
    const error = new Error('Card payments are unavailable because Stripe is not configured.')
    error.statusCode = 503
    throw error
  }

  const baseUrl = buildBaseUrl(request)
  const resolvedSuccessUrl = buildReturnUrl(successUrl, baseUrl, order.orderId)
  const resolvedCancelUrl = buildCancelUrl(cancelUrl, baseUrl, order.orderId)

  const lineItems = [
    ...order.items.map((item) => ({
      quantity: item.quantity,
      price_data: {
        currency: 'zar',
        product_data: {
          name: item.name,
          description: `${order.vendorName} · Prep ${item.prepMinutes} min`,
        },
        unit_amount: item.price * 100,
      },
    })),
    {
      quantity: 1,
      price_data: {
        currency: 'zar',
        product_data: {
          name: 'Delivery fee',
          description: `${order.zoneName} route`,
        },
        unit_amount: order.deliveryFee * 100,
      },
    },
  ]

  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    billing_address_collection: 'required',
    success_url: resolvedSuccessUrl,
    cancel_url: resolvedCancelUrl,
    customer_email: customerEmail || undefined,
    metadata: {
      orderId: order.orderId,
      vendorId: order.vendorId,
      zoneId: order.zoneId,
    },
    line_items: lineItems,
  })

  if (!session.url) {
    const error = new Error('Stripe did not return a checkout URL.')
    error.statusCode = 502
    throw error
  }

  return {
    id: session.id,
    url: session.url,
  }
}
