import bcrypt from 'bcryptjs'
import { randomUUID } from 'node:crypto'
import { config } from './config.js'
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
const pickupStatusSequence = ['requested', 'accepted', 'collecting', 'on-route', 'delivered']
const pickupStatusLabels = {
  requested: 'Requested',
  accepted: 'Driver accepted',
  collecting: 'Collecting item',
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
const pickupRoleTransitions = {
  admin: {
    requested: 'accepted',
    accepted: 'collecting',
    collecting: 'on-route',
    'on-route': 'delivered',
  },
  rider: {
    requested: 'accepted',
    accepted: 'collecting',
    collecting: 'on-route',
    'on-route': 'delivered',
  },
}

const currency = new Intl.NumberFormat('en-ZA', {
  style: 'currency',
  currency: 'ZAR',
  maximumFractionDigits: 0,
})

const zoneMap = new Map(zones.map((zone) => [zone.id, zone]))
const maxStoredUserAgentLength = 255
const maxStoredMessageLength = 320

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

function normalizeEmail(value) {
  return String(value ?? '').trim().toLowerCase()
}

function trimForStorage(value, maxLength) {
  return String(value ?? '').trim().slice(0, maxLength)
}

function parseFutureDate(value) {
  if (!value) {
    return null
  }

  const date = new Date(value)
  return Number.isNaN(date.getTime()) || date.getTime() <= Date.now() ? null : date
}

function minutesUntil(date) {
  return Math.max(1, Math.ceil((date.getTime() - Date.now()) / 60_000))
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

function buildPickupEta(zoneId) {
  return zoneId === 'kwaggafontein' ? '42-55 min' : '35-48 min'
}

function getPickupServiceFee(zoneId) {
  return zoneId === 'kwaggafontein' ? 45 : 35
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

function pickupStatusIndex(status) {
  return pickupStatusSequence.indexOf(status)
}

function buildTrackingSteps(status) {
  const currentIndex = statusIndex(status)

  return statusSequence.map((step, index) => ({
    id: step,
    label: statusLabels[step],
    state: index < currentIndex ? 'done' : index === currentIndex ? 'current' : 'todo',
  }))
}

function buildPickupTrackingSteps(status) {
  const currentIndex = pickupStatusIndex(status)

  return pickupStatusSequence.map((step, index) => ({
    id: step,
    label: pickupStatusLabels[step],
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

function getAllowedNextPickupStatuses(role, status, paymentStatus) {
  if (paymentStatus === 'pending') {
    return []
  }

  const nextStatus = pickupRoleTransitions[role]?.[status]
  return nextStatus ? [nextStatus] : []
}

function mapOrderRow(row, role = 'customer', message) {
  const vendor = getVendorById(row.vendor_id)
  const zone = resolveZone(row.zone_id)
  const paymentStatus = row.payment_status

  return {
    taskType: 'order',
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

function mapPickupRequestRow(row, role = 'customer', message) {
  const zone = resolveZone(row.zone_id)
  const paymentStatus = row.payment_status

  return {
    taskType: 'pickup',
    requestId: row.id,
    customerName: row.customer_name,
    phone: row.phone,
    zoneId: row.zone_id,
    zoneName: zone.name,
    pickupAddress: row.pickup_address,
    dropoffAddress: row.dropoff_address,
    itemDescription: row.item_description,
    paymentMethod: row.payment_method,
    paymentStatus,
    paymentStatusLabel: paymentStatusLabels[paymentStatus] ?? 'Payment status unknown',
    notes: row.notes,
    serviceFee: Number(row.service_fee),
    eta: row.eta,
    status: row.status,
    statusLabel: pickupStatusLabels[row.status],
    requestedAt: row.requested_at,
    assignedRiderName: row.assigned_rider_name ?? null,
    trackingSteps: buildPickupTrackingSteps(row.status),
    allowedNextStatuses: getAllowedNextPickupStatuses(role, row.status, paymentStatus),
    message,
  }
}

function listOrders(whereClause = '', params = []) {
  return all(`SELECT * FROM orders ${whereClause} ORDER BY datetime(placed_at) DESC`, params)
}

function listPickupRequests(whereClause = '', params = []) {
  return all(`SELECT * FROM pickup_requests ${whereClause} ORDER BY datetime(requested_at) DESC`, params)
}

function getRecordTimestamp(record) {
  return record.taskType === 'pickup' ? record.requestedAt : record.placedAt
}

function sortDispatchRecords(records) {
  return [...records].sort((left, right) => {
    const leftTime = new Date(getRecordTimestamp(left)).getTime()
    const rightTime = new Date(getRecordTimestamp(right)).getTime()
    return rightTime - leftTime
  })
}

function listUsersByRole(role) {
  return all('SELECT * FROM users WHERE role = ? ORDER BY rowid ASC', [role]).map(toPublicUser)
}

function getUserRowById(userId) {
  return get('SELECT * FROM users WHERE id = ?', [userId]) ?? null
}

function getUserRowByEmail(email) {
  return get('SELECT * FROM users WHERE email = ?', [normalizeEmail(email)]) ?? null
}

function uniqueZoneIds(zoneIds = []) {
  return [...new Set(zoneIds)]
}

function ensureEmailAvailable(email) {
  if (getUserRowByEmail(email)) {
    throw createHttpError(409, 'An account with this email already exists.')
  }
}

function prepareUserAssignments(role, vendorId, zoneIds = []) {
  const normalizedZoneIds = uniqueZoneIds(zoneIds)

  if (role === 'customer') {
    if (vendorId) {
      throw createHttpError(400, 'Customer accounts cannot be linked to a vendor profile.')
    }

    if (normalizedZoneIds.length !== 1) {
      throw createHttpError(400, 'Customer accounts must include one saved delivery zone.')
    }

    return {
      vendorId: null,
      zoneIds: normalizedZoneIds,
    }
  }

  if (role === 'vendor') {
    if (!vendorId) {
      throw createHttpError(400, 'Vendor accounts must be assigned to a kitchen.')
    }

    const vendor = getVendorById(vendorId)

    return {
      vendorId: vendor.id,
      zoneIds: uniqueZoneIds(vendor.zoneIds),
    }
  }

  if (role === 'rider') {
    if (vendorId) {
      throw createHttpError(400, 'Rider accounts cannot be linked to a vendor profile.')
    }

    if (normalizedZoneIds.length === 0) {
      throw createHttpError(400, 'Rider accounts must include at least one service zone.')
    }

    return {
      vendorId: null,
      zoneIds: normalizedZoneIds,
    }
  }

  if (role === 'admin') {
    if (vendorId) {
      throw createHttpError(400, 'Admin accounts cannot be linked to a vendor profile.')
    }

    return {
      vendorId: null,
      zoneIds: normalizedZoneIds,
    }
  }

  throw createHttpError(400, 'Unsupported account role.')
}

function insertUserRecord({ name, email, phone, role, password, vendorId = null, zoneIds = [] }) {
  const id = randomUUID()
  const normalizedEmail = normalizeEmail(email)
  const normalizedName = trimForStorage(name, 80)
  const normalizedPhone = trimForStorage(phone, 24)
  const serializedZoneIds = JSON.stringify(uniqueZoneIds(zoneIds))

  run(
    `
      INSERT INTO users (id, name, email, phone, role, password_hash, vendor_id, zone_ids)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      id,
      normalizedName,
      normalizedEmail,
      normalizedPhone,
      role,
      bcrypt.hashSync(password, 8),
      vendorId,
      serializedZoneIds,
    ],
  )

  return {
    user: {
      id,
      name: normalizedName,
      email: normalizedEmail,
      phone: normalizedPhone,
      role,
      vendorId: vendorId ?? undefined,
      zoneIds: uniqueZoneIds(zoneIds),
    },
    tokenVersion: 1,
  }
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

export function logSecurityEvent({
  eventType,
  userId = null,
  email = null,
  role = null,
  ipAddress = null,
  userAgent = null,
  targetType = null,
  targetId = null,
  success,
  message,
}) {
  run(
    `
      INSERT INTO security_events (
        id, event_type, user_id, email, role, ip_address, user_agent,
        target_type, target_id, success, message
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      randomUUID(),
      eventType,
      userId,
      email ? normalizeEmail(email) : null,
      role,
      ipAddress ? trimForStorage(ipAddress, 120) : null,
      userAgent ? trimForStorage(userAgent, maxStoredUserAgentLength) : null,
      targetType,
      targetId,
      success ? 1 : 0,
      trimForStorage(message, maxStoredMessageLength),
    ],
  )
}

export function getUserById(userId) {
  const user = getUserRowById(userId)
  return user ? toPublicUser(user) : null
}

export function getAuthUserSnapshot(userId) {
  const user = getUserRowById(userId)

  if (!user) {
    return null
  }

  return {
    user: toPublicUser(user),
    tokenVersion: Number(user.token_version ?? 1),
    lockedUntil: user.locked_until ?? null,
  }
}

export function verifyUserCredentials(email, password, securityContext = {}) {
  const normalizedEmail = normalizeEmail(email)
  const row = getUserRowByEmail(normalizedEmail)

  if (!row) {
    logSecurityEvent({
      eventType: 'auth.login.failed',
      email: normalizedEmail,
      ipAddress: securityContext.ipAddress,
      userAgent: securityContext.userAgent,
      success: false,
      message: 'Unknown email address.',
    })
    throw createHttpError(401, 'Incorrect email or password.')
  }

  const lockedUntil = parseFutureDate(row.locked_until)

  if (lockedUntil) {
    logSecurityEvent({
      eventType: 'auth.login.blocked',
      userId: row.id,
      email: row.email,
      role: row.role,
      ipAddress: securityContext.ipAddress,
      userAgent: securityContext.userAgent,
      success: false,
      message: `Account locked until ${lockedUntil.toISOString()}.`,
    })
    throw createHttpError(
      423,
      `Account temporarily locked. Try again in about ${minutesUntil(lockedUntil)} minute(s).`,
    )
  }

  if (!bcrypt.compareSync(password, row.password_hash)) {
    const nextFailedAttempts = Number(row.failed_login_attempts ?? 0) + 1

    if (nextFailedAttempts >= config.loginMaxAttempts) {
      const nextLockedUntil = new Date(Date.now() + config.loginLockMinutes * 60_000).toISOString()

      run(
        `
          UPDATE users
          SET failed_login_attempts = 0,
              locked_until = ?,
              token_version = COALESCE(token_version, 1) + 1
          WHERE id = ?
        `,
        [nextLockedUntil, row.id],
      )

      logSecurityEvent({
        eventType: 'auth.login.locked',
        userId: row.id,
        email: row.email,
        role: row.role,
        ipAddress: securityContext.ipAddress,
        userAgent: securityContext.userAgent,
        success: false,
        message: `Account locked after ${config.loginMaxAttempts} failed sign-in attempts.`,
      })

      throw createHttpError(
        423,
        `Account temporarily locked after repeated sign-in attempts. Try again in ${config.loginLockMinutes} minute(s).`,
      )
    }

    run('UPDATE users SET failed_login_attempts = ? WHERE id = ?', [nextFailedAttempts, row.id])

    logSecurityEvent({
      eventType: 'auth.login.failed',
      userId: row.id,
      email: row.email,
      role: row.role,
      ipAddress: securityContext.ipAddress,
      userAgent: securityContext.userAgent,
      success: false,
      message: `Invalid password attempt ${nextFailedAttempts} of ${config.loginMaxAttempts}.`,
    })

    throw createHttpError(401, 'Incorrect email or password.')
  }

  run(
    `
      UPDATE users
      SET failed_login_attempts = 0,
          locked_until = NULL,
          last_login_at = ?,
          last_login_ip = ?,
          last_login_user_agent = ?
      WHERE id = ?
    `,
    [
      new Date().toISOString(),
      securityContext.ipAddress ? trimForStorage(securityContext.ipAddress, 120) : null,
      securityContext.userAgent ? trimForStorage(securityContext.userAgent, maxStoredUserAgentLength) : null,
      row.id,
    ],
  )

  logSecurityEvent({
    eventType: 'auth.login.success',
    userId: row.id,
    email: row.email,
    role: row.role,
    ipAddress: securityContext.ipAddress,
    userAgent: securityContext.userAgent,
    success: true,
    message: 'Sign-in successful.',
  })

  return {
    user: toPublicUser(row),
    tokenVersion: Number(row.token_version ?? 1),
  }
}

export function registerCustomerAccount(payload, securityContext = {}) {
  const normalizedEmail = normalizeEmail(payload.email)
  ensureEmailAvailable(normalizedEmail)

  const assignments = prepareUserAssignments('customer', null, [payload.zoneId])
  const snapshot = insertUserRecord({
    name: payload.name,
    email: normalizedEmail,
    phone: payload.phone,
    role: 'customer',
    password: payload.password,
    ...assignments,
  })

  logSecurityEvent({
    eventType: 'auth.register.customer',
    userId: snapshot.user.id,
    email: snapshot.user.email,
    role: snapshot.user.role,
    ipAddress: securityContext.ipAddress,
    userAgent: securityContext.userAgent,
    targetType: 'user',
    targetId: snapshot.user.id,
    success: true,
    message: 'Customer account created from the storefront.',
  })

  return snapshot
}

export function createOperationalUser(payload, actor, securityContext = {}) {
  if (!actor || actor.role !== 'admin') {
    throw createHttpError(403, 'Only admin accounts can create operational users.')
  }

  const normalizedEmail = normalizeEmail(payload.email)
  ensureEmailAvailable(normalizedEmail)

  const assignments = prepareUserAssignments(payload.role, payload.vendorId ?? null, payload.zoneIds ?? [])
  const snapshot = insertUserRecord({
    name: payload.name,
    email: normalizedEmail,
    phone: payload.phone,
    role: payload.role,
    password: payload.password,
    ...assignments,
  })

  logSecurityEvent({
    eventType: 'auth.user.created',
    userId: actor.id,
    email: actor.email,
    role: actor.role,
    ipAddress: securityContext.ipAddress,
    userAgent: securityContext.userAgent,
    targetType: 'user',
    targetId: snapshot.user.id,
    success: true,
    message: `Created ${snapshot.user.role} account for ${snapshot.user.email}.`,
  })

  return snapshot.user
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
  const pickupRequests = listPickupRequests('WHERE customer_id = ?', [user.id]).map((request) =>
    mapPickupRequestRow(request, user.role),
  )

  return {
    customerName: user.name,
    savedZone: resolveZone(user.zoneIds?.[0]).name,
    loyaltyNote:
      'Community regulars unlock faster repeat checkout, saved landmarks, and quicker repeat pickup requests.',
    orders: customerOrders,
    pickupRequests,
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
  const orderTasks = listOrders().filter(
    (order) =>
      order.payment_status !== 'pending' &&
      userMatchesZone(user, order.zone_id) &&
      ((order.status === 'ready' && (!order.assigned_rider_id || order.assigned_rider_id === user.id)) ||
        (order.assigned_rider_id === user.id && order.status !== 'delivered')),
  )
  const pickupTasks = listPickupRequests().filter(
    (request) =>
      userMatchesZone(user, request.zone_id) &&
      ((request.status === 'requested' &&
        (!request.assigned_rider_id || request.assigned_rider_id === user.id)) ||
        (request.assigned_rider_id === user.id && request.status !== 'delivered')),
  )

  const completedOrdersToday = listOrders().filter((order) => {
    const placedAt = new Date(order.placed_at)
    const now = new Date()

    return (
      order.assigned_rider_id === user.id &&
      order.status === 'delivered' &&
      placedAt.toDateString() === now.toDateString()
    )
  })
  const completedPickupRequestsToday = listPickupRequests().filter((request) => {
    const requestedAt = new Date(request.requested_at)
    const now = new Date()

    return (
      request.assigned_rider_id === user.id &&
      request.status === 'delivered' &&
      requestedAt.toDateString() === now.toDateString()
    )
  })
  const tasks = sortDispatchRecords([
    ...orderTasks.map((task) => mapOrderRow(task, user.role)),
    ...pickupTasks.map((task) => mapPickupRequestRow(task, user.role)),
  ])
  const completedToday = completedOrdersToday.length + completedPickupRequestsToday.length
  const earningsToday =
    completedOrdersToday.length * 28 +
    completedPickupRequestsToday.reduce((sum, request) => sum + Number(request.service_fee), 0)

  return {
    riderName: user.name,
    assignedCount: tasks.filter((task) => task.status !== 'delivered').length,
    completedToday,
    earningsToday,
    tasks,
  }
}

export function getAdminOverview() {
  const orders = listOrders()
  const pickupRequests = listPickupRequests()
  const activeOrders = orders.filter((order) => order.status !== 'delivered')
  const activePickupRequests = pickupRequests.filter((request) => request.status !== 'delivered')
  const deliveredToday = orders.filter((order) => {
    const placedAt = new Date(order.placed_at)
    const now = new Date()
    return order.status === 'delivered' && placedAt.toDateString() === now.toDateString()
  }).length
  const completedPickupRequestsToday = pickupRequests.filter((request) => {
    const requestedAt = new Date(request.requested_at)
    const now = new Date()
    return request.status === 'delivered' && requestedAt.toDateString() === now.toDateString()
  }).length
  const revenueToday =
    orders.reduce((sum, order) => sum + Number(order.total), 0) +
    pickupRequests.reduce((sum, request) => sum + Number(request.service_fee), 0)

  return {
    activeOrders: activeOrders.length,
    activePickupRequests: activePickupRequests.length,
    deliveredToday: deliveredToday + completedPickupRequestsToday,
    revenueToday,
    vendorsOnline: all('SELECT COUNT(*) AS count FROM vendors')[0]?.count ?? 0,
    ridersLive: listUsersByRole('rider').length,
    pendingIssues: [
      'Stripe card payments need live test keys before full end-to-end verification.',
      'Push registration only succeeds on physical mobile devices with Expo notifications enabled.',
      'Runner pickup requests currently support cash or eWallet service fees while food orders keep full card checkout.',
      'For Render persistence, attach a disk or move to managed Postgres before heavy production traffic.',
    ],
    orderStages: statusSequence.map((status) => ({
      status,
      label: statusLabels[status],
      count: orders.filter((order) => order.status === status).length,
    })),
    pickupStages: pickupStatusSequence.map((status) => ({
      status,
      label: pickupStatusLabels[status],
      count: pickupRequests.filter((request) => request.status === status).length,
    })),
    liveTasks: sortDispatchRecords([
      ...activeOrders.slice(0, 6).map((order) => mapOrderRow(order, 'admin')),
      ...activePickupRequests.slice(0, 6).map((request) => mapPickupRequestRow(request, 'admin')),
    ]).slice(0, 8),
    headline: `Revenue tracked today: ${currency.format(revenueToday)} | Pickup jobs active: ${activePickupRequests.length}`,
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
  if (actor && actor.role !== 'customer') {
    throw createHttpError(403, 'Only customer accounts can place storefront orders.')
  }

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

export function getPickupRequestById(requestId, role = 'customer', message) {
  const row = get('SELECT * FROM pickup_requests WHERE id = ?', [requestId])

  if (!row) {
    throw createHttpError(404, 'Pickup request not found.')
  }

  return mapPickupRequestRow(row, role, message)
}

export function createPickupRequest(payload, actor) {
  if (actor && actor.role !== 'customer') {
    throw createHttpError(403, 'Only customer accounts can create driver pickup requests.')
  }

  const zone = resolveZone(payload.zoneId)
  const customerUser = actor?.role === 'customer' ? actor : null
  const requestId = `KR-${String(randomUUID()).slice(0, 4).toUpperCase()}`
  const paymentStatus = payload.paymentMethod === 'cash' ? 'cash_on_delivery' : 'paid'

  run(
    `
      INSERT INTO pickup_requests (
        id, customer_id, customer_name, phone, zone_id, pickup_address, dropoff_address,
        item_description, payment_method, payment_status, notes, status, requested_at, eta, service_fee
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      requestId,
      customerUser?.id ?? null,
      payload.customerName || customerUser?.name,
      payload.phone || customerUser?.phone,
      zone.id,
      payload.pickupAddress,
      payload.dropoffAddress,
      payload.itemDescription,
      payload.paymentMethod,
      paymentStatus,
      payload.notes,
      'requested',
      new Date().toISOString(),
      buildPickupEta(zone.id),
      getPickupServiceFee(zone.id),
    ],
  )

  return getPickupRequestById(
    requestId,
    customerUser?.role ?? 'customer',
    `Pickup request ${requestId} is queued for a local driver in ${zone.name}.`,
  )
}

export function updateOrderStatus(orderId, nextStatus, user, securityContext = {}) {
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

  if (user.role === 'rider' && row.assigned_rider_id && row.assigned_rider_id !== user.id) {
    throw createHttpError(403, 'This delivery is already assigned to another rider.')
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

  const updatedOrder = getOrderById(
    orderId,
    user.role,
    `Order ${orderId} moved to ${statusLabels[nextStatus].toLowerCase()}.`,
  )

  logSecurityEvent({
    eventType: 'order.status.updated',
    userId: user.id,
    email: user.email,
    role: user.role,
    ipAddress: securityContext.ipAddress,
    userAgent: securityContext.userAgent,
    targetType: 'order',
    targetId: orderId,
    success: true,
    message: `Moved order from ${row.status} to ${nextStatus}.`,
  })

  return updatedOrder
}

export function updatePickupRequestStatus(requestId, nextStatus, user, securityContext = {}) {
  const row = get('SELECT * FROM pickup_requests WHERE id = ?', [requestId])

  if (!row) {
    throw createHttpError(404, 'Pickup request not found.')
  }

  if (user.role === 'rider' && !userMatchesZone(user, row.zone_id)) {
    throw createHttpError(403, 'This pickup request does not belong to your delivery zone.')
  }

  if (user.role === 'rider' && row.assigned_rider_id && row.assigned_rider_id !== user.id) {
    throw createHttpError(403, 'This pickup request is already assigned to another rider.')
  }

  const allowedNextStatuses = getAllowedNextPickupStatuses(user.role, row.status, row.payment_status)

  if (!allowedNextStatuses.includes(nextStatus)) {
    throw createHttpError(400, `Role ${user.role} cannot move ${row.status} to ${nextStatus}.`)
  }

  const shouldAssignRider = user.role === 'rider' && ['accepted', 'collecting', 'on-route'].includes(nextStatus)

  run(
    `
      UPDATE pickup_requests
      SET status = ?, assigned_rider_id = ?, assigned_rider_name = ?
      WHERE id = ?
    `,
    [
      nextStatus,
      shouldAssignRider ? user.id : row.assigned_rider_id,
      shouldAssignRider ? user.name : row.assigned_rider_name,
      requestId,
    ],
  )

  const updatedRequest = getPickupRequestById(
    requestId,
    user.role,
    `Pickup request ${requestId} moved to ${pickupStatusLabels[nextStatus].toLowerCase()}.`,
  )

  logSecurityEvent({
    eventType: 'pickup.status.updated',
    userId: user.id,
    email: user.email,
    role: user.role,
    ipAddress: securityContext.ipAddress,
    userAgent: securityContext.userAgent,
    targetType: 'pickup-request',
    targetId: requestId,
    success: true,
    message: `Moved pickup request from ${row.status} to ${nextStatus}.`,
  })

  return updatedRequest
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

export { paymentStatusLabels, pickupStatusLabels, statusLabels }
