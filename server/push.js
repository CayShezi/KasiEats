import {
  getPushRecipientsForOrderCreated,
  getPushRecipientsForOrderStatus,
  getPushRecipientsForPickupCreated,
  getPushRecipientsForPickupStatus,
  getPushTokensForUsers,
  logNotificationAttempt,
} from './store.js'
import { config } from './config.js'

const expoPushEndpoint = 'https://exp.host/--/api/v2/push/send'
const expoPushChunkSize = 100

function isExpoPushToken(token) {
  return /^(ExponentPushToken|ExpoPushToken)\[.+\]$/.test(String(token ?? ''))
}

function dedupeUsers(users) {
  const seen = new Set()

  return users.filter((user) => {
    if (seen.has(user.id)) {
      return false
    }

    seen.add(user.id)
    return true
  })
}

function dedupeMessages(messages) {
  const seen = new Set()

  return messages.filter((message) => {
    const key = `${message.userId}:${message.token}:${message.orderId ?? ''}:${message.pickupRequestId ?? ''}`

    if (seen.has(key)) {
      return false
    }

    seen.add(key)
    return true
  })
}

function chunkMessages(messages, size) {
  const chunks = []

  for (let index = 0; index < messages.length; index += size) {
    chunks.push(messages.slice(index, index + size))
  }

  return chunks
}

async function sendPushBatch(messages) {
  if (!messages.length) {
    return {
      queued: 0,
      delivered: 0,
      failed: 0,
    }
  }

  const dedupedMessages = dedupeMessages(messages)
  const validMessages = []
  const invalidMessages = []

  dedupedMessages.forEach((message) => {
    if (isExpoPushToken(message.token)) {
      validMessages.push(message)
    } else {
      invalidMessages.push(message)
    }
  })

  invalidMessages.forEach((message) => {
    logNotificationAttempt({
      userId: message.userId,
      orderId: message.orderId,
      pickupRequestId: message.pickupRequestId,
      token: message.token,
      title: message.title,
      body: message.body,
      status: 'invalid_token',
      providerResponse: 'Token does not look like a valid Expo push token.',
    })
  })

  if (!validMessages.length) {
    return {
      queued: 0,
      delivered: 0,
      failed: invalidMessages.length,
    }
  }

  let delivered = 0
  let failed = invalidMessages.length

  for (const batch of chunkMessages(validMessages, expoPushChunkSize)) {
    let providerPayload = null

    try {
      const response = await fetch(expoPushEndpoint, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(
          batch.map((message) => ({
            to: message.token,
            title: message.title,
            body: message.body,
            data: message.data,
            sound: 'default',
            channelId: 'orders',
          })),
        ),
        signal: AbortSignal.timeout(config.pushRequestTimeoutMs),
      })

      providerPayload = await response.json().catch(() => null)

      const tickets = Array.isArray(providerPayload?.data) ? providerPayload.data : []

      batch.forEach((message, index) => {
        const ticket = tickets[index]
        const status = ticket?.status ?? (response.ok ? 'queued' : 'provider_error')

        if (ticket?.status === 'ok') {
          delivered += 1
        } else if (ticket?.status === 'error') {
          failed += 1
        }

        logNotificationAttempt({
          userId: message.userId,
          orderId: message.orderId,
          pickupRequestId: message.pickupRequestId,
          token: message.token,
          title: message.title,
          body: message.body,
          status,
          providerResponse: JSON.stringify(ticket ?? providerPayload ?? { statusCode: response.status }),
        })
      })
    } catch (error) {
      failed += batch.length

      batch.forEach((message) => {
        logNotificationAttempt({
          userId: message.userId,
          orderId: message.orderId,
          pickupRequestId: message.pickupRequestId,
          token: message.token,
          title: message.title,
          body: message.body,
          status: 'provider_error',
          providerResponse: error instanceof Error ? error.message : 'Unknown Expo push error.',
        })
      })
    }
  }

  return {
    queued: validMessages.length,
    delivered,
    failed,
  }
}

async function notifyUsers(users, title, body, order) {
  const uniqueUsers = dedupeUsers(users)
  const tokens = getPushTokensForUsers(uniqueUsers.map((user) => user.id))

  return sendPushBatch(
    tokens.map((token) => ({
      userId: token.user_id,
      token: token.token,
      title,
      body,
      orderId: order.orderId,
      data: {
        taskType: 'order',
        orderId: order.orderId,
        status: order.status,
        paymentStatus: order.paymentStatus,
      },
    })),
  )
}

async function notifyUsersForPickup(users, title, body, pickupRequest) {
  const uniqueUsers = dedupeUsers(users)
  const tokens = getPushTokensForUsers(uniqueUsers.map((user) => user.id))

  return sendPushBatch(
    tokens.map((token) => ({
      userId: token.user_id,
      token: token.token,
      title,
      body,
      pickupRequestId: pickupRequest.requestId,
      data: {
        taskType: 'pickup',
        pickupRequestId: pickupRequest.requestId,
        status: pickupRequest.status,
        paymentStatus: pickupRequest.paymentStatus,
      },
    })),
  )
}

export async function notifyOrderCreated(order) {
  const recipients = getPushRecipientsForOrderCreated(order.orderId)
  const title = `New order ${order.orderId}`
  const body = `${order.customerName} placed ${order.items.length} item${order.items.length === 1 ? '' : 's'} for ${order.vendorName}.`

  return notifyUsers(recipients, title, body, order)
}

export async function notifyOrderStatus(order) {
  const recipients = getPushRecipientsForOrderStatus(order.orderId)
  const title = `Order ${order.orderId}`
  const body =
    order.status === 'ready'
      ? `${order.vendorName} has the order ready for pickup in ${order.zoneName}.`
      : `Your order is now ${order.statusLabel.toLowerCase()}.`

  return notifyUsers(recipients, title, body, order)
}

export async function notifyPickupCreated(pickupRequest) {
  const recipients = getPushRecipientsForPickupCreated(pickupRequest.requestId)
  const title = `New pickup ${pickupRequest.requestId}`
  const body = `${pickupRequest.customerName} requested a runner pickup in ${pickupRequest.zoneName}.`

  return notifyUsersForPickup(recipients, title, body, pickupRequest)
}

export async function notifyPickupStatus(pickupRequest) {
  const recipients = getPushRecipientsForPickupStatus(pickupRequest.requestId)

  if (!recipients.length) {
    return {
      queued: 0,
      delivered: 0,
      failed: 0,
    }
  }

  const title = `Pickup ${pickupRequest.requestId}`
  const body =
    pickupRequest.status === 'accepted'
      ? `A runner accepted your request in ${pickupRequest.zoneName}.`
      : pickupRequest.status === 'collecting'
        ? `Your runner is collecting the item from ${pickupRequest.pickupAddress}.`
        : pickupRequest.status === 'on-route'
          ? `Your runner is on the way to ${pickupRequest.dropoffAddress}.`
          : pickupRequest.status === 'delivered'
            ? 'Your pickup request has been delivered.'
            : `Your pickup request is now ${pickupRequest.statusLabel.toLowerCase()}.`

  return notifyUsersForPickup(recipients, title, body, pickupRequest)
}
