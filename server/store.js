import bcrypt from 'bcryptjs'
import { randomUUID } from 'node:crypto'
import { stats, zones } from './data.js'
import { all, get, mapVendorMenuItems, run, transaction } from './db.js'

const statusSequence = ['placed', 'accepted', 'preparing', 'ready', 'on-route', 'delivered']
const statusLabels = {
  placed: 'Placed',
  accepted: 'Kitchen accepted',
  preparing: 'Preparing',
  ready: 'Ready for pickup',
  'on-route': 'On route',
  delivered: 'Delivered',
}
const paymentStatusLabels = {
  pending: 'Awaiting payment',
  paid: 'Paid',
  cash_on_delivery: 'Cash on delivery',
  failed: 'Payment failed',
  cancelled: 'Payment cancelled',
}
const roleTransitions = {
  admin: {
    placed: 'accepted',
    accepted: 'preparing',
    preparing: 'ready',
    ready: 'on-route',
    'on-route': 'delivered',
  },
  vendor: {
    placed: 'accepted',
    accepted: 'preparing',
    preparing: 'ready',
  },
  rider: {
    ready: 'on-route',
    'on-route': 'delivered',
  },
}

const currency = new Intl.NumberFormat('en-ZA', {
  style: 'currency',
  currency: 'ZAR',
  maximumFractionDigits: 0,
})

const zoneMap = new Map(zones.map((zone) => [zone.id, zone]))

function parseJson(value, fallback) {
  try {
    return value ? JSON.parse(value) : fallback
  } catch {
    return fallback
  }
}

function createHttpError(statusCode, message) {
  const error = new Error(message)
  error.statusCode = statusCode
  return error
}

function resolveZone(zoneId) {
  return zoneMap.get(zoneId) ?? zones[0]
}

function getVendorRow(vendorId) {
  return get('SELECT * FROM vendors WHERE id = ?', [vendorId]) ?? null
}

function mapVendorRow(row) {
  if (!row) {
    return null
  }

  return {
    id: row.id,
    name: row.name,
    area: row.area,
    tagline: row.tagline,
    description: row.description,
    rating: Number(row.rating),
    eta: row.eta,
    deliveryFee: Number(row.delivery_fee),
    heroLabel: row.hero_label,
    spotlight: row.spotlight,
    zoneIds: parseJson(row.zone_ids, []),
    categories: parseJson(row.categories, []),
    menu: mapVendorMenuItems(row.id).map((item) => ({
      id: item.id,
      name: item.name,
      description: item.description,
      price: Number(item.price),
      prepMinutes: Number(item.prep_minutes),
      badge: item.badge ?? undefined,
    })),
  }
}

function getVendorById(vendorId) {
  const vendor = mapVendorRow(getVendorRow(vendorId))

  if (!vendor) {
    throw createHttpError(404, 'Vendor not found.')
  }

  return vendor
}

function listVendors() {
  return all('SELECT * FROM vendors ORDER BY rowid ASC').map(mapVendorRow)
}

function buildEta(zoneId) {
  return zoneId === 'kwaggafontein' ? '28-36 min' : '22-30 min'
}

function getOrderItems(orderId) {
  return all(
    `
      SELECT id, menu_item_id, name, quantity, price, prep_minutes
      FROM order_items
      WHERE order_id = ?
      ORDER BY rowid ASC
    `,
    [orderId],
  ).map((row) => ({
    id: row.menu_item_id,
    name: row.name,
    quantity: Number(row.quantity),
    price: Number(row.price),
    prepMinutes: Number(row.prep_minutes),
  }))
}

function statusIndex(status) {
  return statusSequence.indexOf(status)
}

function buildTrackingSteps(status) {
  const currentIndex = statusIndex(status)

  return statusSequence.map((step, index) => ({
    id: step,
    label: statusLabels[step],
    state: index < currentIndex ? 'done' : index === currentIndex ? 'current' : 'todo',
  }))
}

function getAllowedNextStatuses(role, status, paymentStatus) {
  if (paymentStatus === 'pending') {
    return []
  }

  const nextStatus = roleTransitions[role]?.[status]
  return nextStatus ? [nextStatus] : []
}

function mapOrderRow(row, role = 'customer', message) {
  const vendor = getVendorById(row.vendor_id)
  const zone = resolveZone(row.zone_id)
  const paymentStatus = row.payment_status

  return {
    orderId: row.id,
    customerName: row.customer_name,
    vendorId: row.vendor_id,
    vendorName: vendor.name,
    zoneId: row.zone_id,
    zoneName: zone.name,
    address: row.address,
    paymentMethod: row.payment_method,
    paymentStatus,
    paymentStatusLabel: paymentStatusLabels[paymentStatus] ?? 'Payment status unknown',
    paymentUrl: row.checkout_url ?? null,
    notes: row.notes,
    total: Number(row.total),
    deliveryFee: vendor.deliveryFee,
    eta: row.eta,
    status: row.status,
    statusLabel: statusLabels[row.status],
    placedAt: row.placed_at,
    assignedRiderName: row.assigned_rider_name ?? null,
    trackingSteps: buildTrackingSteps(row.status),
    allowedNextStatuses: getAllowedNextStatuses(role, row.status, paymentStatus),
    items: getOrderItems(row.id),
    message,
  }
}

function listOrders(whereClause = '', params = []) {
  return all(`SELECT * FROM orders ${whereClause} ORDER BY datetime(placed_at) DESC`, params)
}

function listUsersByRole(role) {
  return all('SELECT * FROM users WHERE role = ? ORDER BY rowid ASC', [role]).map(toPublicUser)
}

function userMatchesZone(user, zoneId) {
  return !user.zoneIds || user.zoneIds.includes(zoneId)
}

function resolveMenuItem(vendor, menuItemId) {
  const menuItem = vendor.menu.find((item) => item.id === menuItemId)

  if (!menuItem) {
    throw createHttpError(400, `Menu item ${menuItemId} does not exist for ${vendor.name}.`)
  }

  return menuItem
}

export function toPublicUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    role: user.role,
    vendorId: user.vendor_id ?? undefined,
    zoneIds: parseJson(user.zone_ids, []),
  }
}

export function getUserById(userId) {
  const user = get('SELECT * FROM users WHERE id = ?', [userId])
  return user ? toPublicUser(user) : null
}

export function verifyUserCredentials(email, password) {
  const row = get('SELECT * FROM users WHERE email = ?', [email.toLowerCase()])

  if (!row || !bcrypt.compareSync(password, row.password_hash)) {
    throw createHttpError(401, 'Incorrect email or password.')
  }

  return toPublicUser(row)
}

export function getMarketplace({ zoneId, search } = {}) {
  const normalizedSearch = String(search ?? '').trim().toLowerCase()
  const normalizedZone = String(zoneId ?? '').trim().toLowerCase()

  const visibleVendors = listVendors().filter((vendor) => {
    const matchesZone = normalizedZone ? vendor.zoneIds.includes(normalizedZone) : true

    if (!normalizedSearch) {
      return matchesZone
    }

    const searchableText = [
      vendor.name,
      vendor.tagline,
      vendor.area,
      vendor.description,
      vendor.categories.join(' '),
      vendor.menu.map((item) => `${item.name} ${item.description}`).join(' '),
    ]
      .join(' ')
      .toLowerCase()

    return matchesZone && searchableText.includes(normalizedSearch)
  })

  return {
    zones,
    stats,
    vendors: visibleVendors,
  }
}

export function getCustomerDashboard(user) {
  const customerOrders = listOrders('WHERE customer_id = ?', [user.id]).map((order) =>
    mapOrderRow(order, user.role),
  )

  return {
    customerName: user.name,
    savedZone: resolveZone(user.zoneIds?.[0]).name,
    loyaltyNote: 'Community regulars unlock faster repeat checkout and clearer saved drop points.',
    orders: customerOrders,
  }
}

export function getVendorDashboard(user) {
  const vendor = getVendorById(user.vendorId)
  const vendorOrders = listOrders('WHERE vendor_id = ?', [user.vendorId])

  const activeVendorOrders = vendorOrders.filter((order) => order.payment_status !== 'pending')
  const queueCount = activeVendorOrders.filter((order) =>
    ['placed', 'accepted', 'preparing'].includes(order.status),
  ).length
  const readyCount = activeVendorOrders.filter((order) => order.status === 'ready').length
  const avgPrepTime = Math.round(
    vendor.menu.reduce((sum, item) => sum + item.prepMinutes, 0) / Math.max(vendor.menu.length, 1),
  )
  const topItems = all(
    `
      SELECT oi.name AS name, SUM(oi.quantity) AS orders
      FROM order_items oi
      INNER JOIN orders o ON o.id = oi.order_id
      WHERE o.vendor_id = ?
      GROUP BY oi.name
      ORDER BY orders DESC
      LIMIT 3
    `,
    [user.vendorId],
  ).map((row) => ({
    name: row.name,
    orders: Number(row.orders),
  }))

  return {
    vendorId: vendor.id,
    vendorName: vendor.name,
    queueCount,
    readyCount,
    avgPrepTime,
    topItems,
    liveOrders: vendorOrders
      .filter((order) => order.status !== 'delivered')
      .map((order) => mapOrderRow(order, user.role)),
  }
}

export function getRiderDashboard(user) {
  const tasks = listOrders().filter(
    (order) =>
      order.payment_status !== 'pending' &&
      userMatchesZone(user, order.zone_id) &&
      ((order.assigned_rider_id === user.id && order.status !== 'delivered') ||
        order.status === 'ready' ||
        order.status === 'on-route'),
  )

  const completedToday = listOrders().filter((order) => {
    const placedAt = new Date(order.placed_at)
    const now = new Date()

    return (
      order.assigned_rider_id === user.id &&
      order.status === 'delivered' &&
      placedAt.toDateString() === now.toDateString()
    )
  }).length

  return {
    riderName: user.name,
    assignedCount: tasks.filter((task) => task.status !== 'delivered').length,
    completedToday,
    earningsToday: completedToday * 28,
    tasks: tasks.map((task) => mapOrderRow(task, user.role)),
  }
}

export function getAdminOverview() {
  const orders = listOrders()
  const activeOrders = orders.filter((order) => order.status !== 'delivered')
  const deliveredToday = orders.filter((order) => {
    const placedAt = new Date(order.placed_at)
    const now = new Date()
    return order.status === 'delivered' && placedAt.toDateString() === now.toDateString()
  }).length
  const revenueToday = orders.reduce((sum, order) => sum + Number(order.total), 0)

  return {
    activeOrders: activeOrders.length,
    deliveredToday,
    revenueToday,
    vendorsOnline: all('SELECT COUNT(*) AS count FROM vendors')[0]?.count ?? 0,
    ridersLive: listUsersByRole('rider').length,
    pendingIssues: [
      'Stripe card payments need live test keys before full end-to-end verification.',
      'Push registration only succeeds on physical mobile devices with Expo notifications enabled.',
      'For Render persistence, attach a disk or move to managed Postgres before heavy production traffic.',
    ],
    orderStages: statusSequence.map((status) => ({
      status,
      label: statusLabels[status],
      count: orders.filter((order) => order.status === status).length,
    })),
    liveOrders: activeOrders.slice(0, 6).map((order) => mapOrderRow(order, 'admin')),
    headline: `Revenue tracked today: ${currency.format(revenueToday)}`,
  }
}

export function getOrderById(orderId, role = 'customer', message) {
  const row = get('SELECT * FROM orders WHERE id = ?', [orderId])

  if (!row) {
    throw createHttpError(404, 'Order not found.')
  }

  return mapOrderRow(row, role, message)
}

export function createOrder(payload, actor) {
  const vendorId = payload.items[0]?.vendorId

  if (!vendorId || payload.items.some((item) => item.vendorId !== vendorId)) {
    throw createHttpError(400, 'Basket items must come from a single vendor.')
  }

  const vendor = getVendorById(vendorId)
  const zone = resolveZone(payload.zoneId)
  const customerUser = actor?.role === 'customer' ? actor : null
  const lineItems = payload.items.map((entry) => {
    const menuItem = resolveMenuItem(vendor, entry.menuItemId)

    return {
      id: randomUUID(),
      menuItemId: menuItem.id,
      name: menuItem.name,
      quantity: entry.quantity,
      price: menuItem.price,
      prepMinutes: menuItem.prepMinutes,
    }
  })
  const total = lineItems.reduce((sum, item) => sum + item.price * item.quantity, 0) + vendor.deliveryFee
  const orderId = `KE-${String(randomUUID()).slice(0, 4).toUpperCase()}`
  const paymentStatus =
    payload.paymentMethod === 'cash'
      ? 'cash_on_delivery'
      : payload.paymentMethod === 'card'
        ? 'pending'
        : 'paid'

  transaction(() => {
    run(
      `
        INSERT INTO orders (
          id, customer_id, customer_name, phone, vendor_id, zone_id, address,
          payment_method, payment_status, notes, status, placed_at, eta, total
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        orderId,
        customerUser?.id ?? null,
        payload.customerName || customerUser?.name,
        payload.phone || customerUser?.phone,
        vendorId,
        zone.id,
        payload.address,
        payload.paymentMethod,
        paymentStatus,
        payload.notes,
        'placed',
        new Date().toISOString(),
        buildEta(zone.id),
        total,
      ],
    )

    lineItems.forEach((item) => {
      run(
        `
          INSERT INTO order_items (id, order_id, menu_item_id, name, quantity, price, prep_minutes)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `,
        [item.id, orderId, item.menuItemId, item.name, item.quantity, item.price, item.prepMinutes],
      )
    })
  })

  return getOrderById(
    orderId,
    customerUser?.role ?? 'customer',
    `Order ${orderId} is now with ${vendor.name} and queued for dispatch in ${zone.name}.`,
  )
}

export function updateOrderStatus(orderId, nextStatus, user) {
  const row = get('SELECT * FROM orders WHERE id = ?', [orderId])

  if (!row) {
    throw createHttpError(404, 'Order not found.')
  }

  if (row.payment_status === 'pending') {
    throw createHttpError(400, 'Card payment has not been completed for this order yet.')
  }

  if (user.role === 'vendor' && row.vendor_id !== user.vendorId) {
    throw createHttpError(403, 'You can only manage orders for your own kitchen.')
  }

  if (user.role === 'rider' && !userMatchesZone(user, row.zone_id)) {
    throw createHttpError(403, 'This route does not belong to your delivery zone.')
  }

  const allowedNextStatuses = getAllowedNextStatuses(user.role, row.status, row.payment_status)

  if (!allowedNextStatuses.includes(nextStatus)) {
    throw createHttpError(400, `Role ${user.role} cannot move ${row.status} to ${nextStatus}.`)
  }

  run(
    `
      UPDATE orders
      SET status = ?, assigned_rider_id = ?, assigned_rider_name = ?
      WHERE id = ?
    `,
    [
      nextStatus,
      user.role === 'rider' && nextStatus === 'on-route' ? user.id : row.assigned_rider_id,
      user.role === 'rider' && nextStatus === 'on-route' ? user.name : row.assigned_rider_name,
      orderId,
    ],
  )

  return getOrderById(orderId, user.role, `Order ${orderId} moved to ${statusLabels[nextStatus].toLowerCase()}.`)
}

export function attachCheckoutSession(orderId, sessionId, checkoutUrl) {
  run(
    `
      UPDATE orders
      SET checkout_session_id = ?, checkout_url = ?, payment_status = 'pending'
      WHERE id = ?
    `,
    [sessionId, checkoutUrl, orderId],
  )

  return getOrderById(orderId)
}

export function markOrderPaymentStatus(orderId, nextStatus, paymentReference = null) {
  run(
    `
      UPDATE orders
      SET payment_status = ?, payment_reference = ?, checkout_url = NULL
      WHERE id = ?
    `,
    [nextStatus, paymentReference, orderId],
  )

  return getOrderById(orderId)
}

export function markCheckoutPaid(sessionId, paymentReference) {
  const row = get('SELECT id FROM orders WHERE checkout_session_id = ?', [sessionId])

  if (!row) {
    return null
  }

  run(
    `
      UPDATE orders
      SET payment_status = 'paid', payment_reference = ?, checkout_url = NULL
      WHERE checkout_session_id = ?
    `,
    [paymentReference ?? null, sessionId],
  )

  return getOrderById(row.id)
}

export function markCheckoutFailed(sessionId, nextStatus) {
  const row = get('SELECT id FROM orders WHERE checkout_session_id = ?', [sessionId])

  if (!row) {
    return null
  }

  run(
    `
      UPDATE orders
      SET payment_status = ?, checkout_url = NULL
      WHERE checkout_session_id = ?
    `,
    [nextStatus, sessionId],
  )

  return getOrderById(row.id)
}

export function registerPushToken(userId, token, platform) {
  run(
    `
      INSERT INTO push_tokens (id, user_id, token, platform)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(token) DO UPDATE SET
        user_id = excluded.user_id,
        platform = excluded.platform,
        created_at = CURRENT_TIMESTAMP
    `,
    [randomUUID(), userId, token, platform],
  )
}

export function getPushRecipientsForOrderCreated(orderId) {
  const order = getOrderById(orderId)
  const vendorUsers = all('SELECT * FROM users WHERE role = ? AND vendor_id = ?', ['vendor', order.vendorId]).map(
    toPublicUser,
  )
  const adminUsers = listUsersByRole('admin')

  return [...vendorUsers, ...adminUsers]
}

export function getPushRecipientsForOrderStatus(orderId) {
  const order = getOrderById(orderId)
  const recipients = []

  const customerRow = get('SELECT * FROM users WHERE id = (SELECT customer_id FROM orders WHERE id = ?)', [orderId])
  if (customerRow) {
    recipients.push(toPublicUser(customerRow))
  }

  if (order.status === 'ready') {
    listUsersByRole('rider')
      .filter((user) => userMatchesZone(user, order.zoneId))
      .forEach((user) => recipients.push(user))
  }

  return recipients
}

export function getPushTokensForUsers(userIds) {
  if (!userIds.length) {
    return []
  }

  const placeholders = userIds.map(() => '?').join(', ')
  return all(`SELECT user_id, token, platform FROM push_tokens WHERE user_id IN (${placeholders})`, userIds)
}

export function logNotificationAttempt({ userId, orderId, token, title, body, status, providerResponse }) {
  run(
    `
      INSERT INTO notification_logs (id, user_id, order_id, token, title, body, status, provider_response)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [randomUUID(), userId ?? null, orderId ?? null, token, title, body, status, providerResponse ?? null],
  )
}

export { paymentStatusLabels, statusLabels }
