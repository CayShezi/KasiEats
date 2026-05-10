import {
  getPushRecipientsForOrderCreated,
  getPushRecipientsForOrderStatus,
  getPushTokensForUsers,
  logNotificationAttempt,
} from './store.js'

const expoPushEndpoint = 'https://exp.host/--/api/v2/push/send'

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

async function sendPushBatch(messages) {
  if (!messages.length) {
    return {
      queued: 0,
      delivered: 0,
      failed: 0,
    }
  }

  const validMessages = []
  const invalidMessages = []

  messages.forEach((message) => {
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

  let providerPayload = null

  try {
    const response = await fetch(expoPushEndpoint, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(
        validMessages.map((message) => ({
          to: message.token,
          title: message.title,
          body: message.body,
          data: message.data,
          sound: 'default',
          channelId: 'orders',
        })),
      ),
    })

    providerPayload = await response.json().catch(() => null)

    const tickets = Array.isArray(providerPayload?.data) ? providerPayload.data : []

    validMessages.forEach((message, index) => {
      const ticket = tickets[index]
      const status = ticket?.status ?? (response.ok ? 'queued' : 'provider_error')

      logNotificationAttempt({
        userId: message.userId,
        orderId: message.orderId,
        token: message.token,
        title: message.title,
        body: message.body,
        status,
        providerResponse: JSON.stringify(ticket ?? providerPayload ?? { statusCode: response.status }),
      })
    })

    return {
      queued: validMessages.length,
      delivered: tickets.filter((ticket) => ticket?.status === 'ok').length,
      failed: invalidMessages.length + tickets.filter((ticket) => ticket?.status === 'error').length,
    }
  } catch (error) {
    validMessages.forEach((message) => {
      logNotificationAttempt({
        userId: message.userId,
        orderId: message.orderId,
        token: message.token,
        title: message.title,
        body: message.body,
        status: 'provider_error',
        providerResponse: error instanceof Error ? error.message : 'Unknown Expo push error.',
      })
    })

    return {
      queued: validMessages.length,
      delivered: 0,
      failed: validMessages.length + invalidMessages.length,
    }
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
        orderId: order.orderId,
        status: order.status,
        paymentStatus: order.paymentStatus,
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
