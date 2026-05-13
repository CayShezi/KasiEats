import bcrypt from 'bcryptjs'
import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { config } from './config.js'
import { vendors, zones } from './data.js'

const demoPassword = 'Welcome123!'

mkdirSync(config.dataDir, { recursive: true })

const db = new DatabaseSync(config.databasePath)
db.exec('PRAGMA foreign_keys = ON;')

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    phone TEXT NOT NULL,
    role TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    vendor_id TEXT,
    zone_ids TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS vendors (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    area TEXT NOT NULL,
    tagline TEXT NOT NULL,
    description TEXT NOT NULL,
    rating REAL NOT NULL,
    eta TEXT NOT NULL,
    delivery_fee INTEGER NOT NULL,
    hero_label TEXT NOT NULL,
    spotlight TEXT NOT NULL,
    zone_ids TEXT NOT NULL,
    categories TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS menu_items (
    id TEXT PRIMARY KEY,
    vendor_id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    price INTEGER NOT NULL,
    prep_minutes INTEGER NOT NULL,
    badge TEXT,
    FOREIGN KEY (vendor_id) REFERENCES vendors(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY,
    customer_id TEXT,
    customer_name TEXT NOT NULL,
    phone TEXT NOT NULL,
    vendor_id TEXT NOT NULL,
    zone_id TEXT NOT NULL,
    address TEXT NOT NULL,
    payment_method TEXT NOT NULL,
    payment_status TEXT NOT NULL,
    checkout_session_id TEXT,
    checkout_url TEXT,
    payment_reference TEXT,
    notes TEXT NOT NULL,
    status TEXT NOT NULL,
    placed_at TEXT NOT NULL,
    eta TEXT NOT NULL,
    assigned_rider_id TEXT,
    assigned_rider_name TEXT,
    total INTEGER NOT NULL,
    FOREIGN KEY (customer_id) REFERENCES users(id) ON DELETE SET NULL,
    FOREIGN KEY (vendor_id) REFERENCES vendors(id) ON DELETE CASCADE,
    FOREIGN KEY (assigned_rider_id) REFERENCES users(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS pickup_requests (
    id TEXT PRIMARY KEY,
    customer_id TEXT,
    customer_name TEXT NOT NULL,
    phone TEXT NOT NULL,
    zone_id TEXT NOT NULL,
    pickup_address TEXT NOT NULL,
    dropoff_address TEXT NOT NULL,
    item_description TEXT NOT NULL,
    payment_method TEXT NOT NULL,
    payment_status TEXT NOT NULL,
    notes TEXT NOT NULL,
    status TEXT NOT NULL,
    requested_at TEXT NOT NULL,
    eta TEXT NOT NULL,
    service_fee INTEGER NOT NULL,
    assigned_rider_id TEXT,
    assigned_rider_name TEXT,
    FOREIGN KEY (customer_id) REFERENCES users(id) ON DELETE SET NULL,
    FOREIGN KEY (assigned_rider_id) REFERENCES users(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS order_items (
    id TEXT PRIMARY KEY,
    order_id TEXT NOT NULL,
    menu_item_id TEXT NOT NULL,
    name TEXT NOT NULL,
    quantity INTEGER NOT NULL,
    price INTEGER NOT NULL,
    prep_minutes INTEGER NOT NULL,
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS push_tokens (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    token TEXT NOT NULL UNIQUE,
    platform TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS notification_logs (
    id TEXT PRIMARY KEY,
    user_id TEXT,
    order_id TEXT,
    token TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    status TEXT NOT NULL,
    provider_response TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS security_events (
    id TEXT PRIMARY KEY,
    event_type TEXT NOT NULL,
    user_id TEXT,
    email TEXT,
    role TEXT,
    ip_address TEXT,
    user_agent TEXT,
    target_type TEXT,
    target_id TEXT,
    success INTEGER NOT NULL,
    message TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_orders_customer_id ON orders(customer_id);
  CREATE INDEX IF NOT EXISTS idx_orders_vendor_id ON orders(vendor_id);
  CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
  CREATE INDEX IF NOT EXISTS idx_orders_payment_status ON orders(payment_status);
  CREATE INDEX IF NOT EXISTS idx_pickups_customer_id ON pickup_requests(customer_id);
  CREATE INDEX IF NOT EXISTS idx_pickups_zone_id ON pickup_requests(zone_id);
  CREATE INDEX IF NOT EXISTS idx_pickups_status ON pickup_requests(status);
  CREATE INDEX IF NOT EXISTS idx_pickups_assigned_rider_id ON pickup_requests(assigned_rider_id);
  CREATE INDEX IF NOT EXISTS idx_menu_items_vendor_id ON menu_items(vendor_id);
  CREATE INDEX IF NOT EXISTS idx_push_tokens_user_id ON push_tokens(user_id);
  CREATE INDEX IF NOT EXISTS idx_security_events_user_id ON security_events(user_id);
  CREATE INDEX IF NOT EXISTS idx_security_events_type ON security_events(event_type);
`)

function columnExists(tableName, columnName) {
  return all(`PRAGMA table_info(${tableName})`).some((column) => column.name === columnName)
}

function ensureColumn(tableName, columnName, definition) {
  if (!columnExists(tableName, columnName)) {
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`)
  }
}

ensureColumn('users', 'token_version', 'INTEGER NOT NULL DEFAULT 1')
ensureColumn('users', 'failed_login_attempts', 'INTEGER NOT NULL DEFAULT 0')
ensureColumn('users', 'locked_until', 'TEXT')
ensureColumn('users', 'last_login_at', 'TEXT')
ensureColumn('users', 'last_login_ip', 'TEXT')
ensureColumn('users', 'last_login_user_agent', 'TEXT')

function run(sql, params = []) {
  return db.prepare(sql).run(...params)
}

function get(sql, params = []) {
  return db.prepare(sql).get(...params)
}

function all(sql, params = []) {
  return db.prepare(sql).all(...params)
}

function transaction(callback) {
  db.exec('BEGIN')

  try {
    const result = callback()
    db.exec('COMMIT')
    return result
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

function mapVendorMenuItems(vendorId) {
  return all(
    `
      SELECT id, name, description, price, prep_minutes, badge
      FROM menu_items
      WHERE vendor_id = ?
      ORDER BY rowid ASC
    `,
    [vendorId],
  )
}

function seedDatabase() {
  const vendorCount = get('SELECT COUNT(*) AS count FROM vendors')?.count ?? 0

  if (vendorCount === 0) {
    transaction(() => {
      vendors.forEach((vendor) => {
        run(
          `
            INSERT INTO vendors (
              id, name, area, tagline, description, rating, eta, delivery_fee,
              hero_label, spotlight, zone_ids, categories
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `,
          [
            vendor.id,
            vendor.name,
            vendor.area,
            vendor.tagline,
            vendor.description,
            vendor.rating,
            vendor.eta,
            vendor.deliveryFee,
            vendor.heroLabel,
            vendor.spotlight,
            JSON.stringify(vendor.zoneIds),
            JSON.stringify(vendor.categories),
          ],
        )

        vendor.menu.forEach((item) => {
          run(
            `
              INSERT INTO menu_items (id, vendor_id, name, description, price, prep_minutes, badge)
              VALUES (?, ?, ?, ?, ?, ?, ?)
            `,
            [
              item.id,
              vendor.id,
              item.name,
              item.description,
              item.price,
              item.prepMinutes,
              item.badge ?? null,
            ],
          )
        })
      })
    })
  }

  const userCount = get('SELECT COUNT(*) AS count FROM users')?.count ?? 0

  if (userCount === 0) {
    const users = [
      {
        id: 'customer-001',
        name: 'Thandeka Mabuza',
        email: 'customer@kasieats.demo',
        phone: '071 555 0101',
        role: 'customer',
        vendorId: null,
        zoneIds: ['kwamhlanga'],
      },
      {
        id: 'vendor-001',
        name: 'Bongani Nkosi',
        email: 'vendor@kasieats.demo',
        phone: '071 555 0102',
        role: 'vendor',
        vendorId: 'spaza-flame-grill',
        zoneIds: [],
      },
      {
        id: 'rider-001',
        name: 'Lebo Mokoena',
        email: 'rider@kasieats.demo',
        phone: '071 555 0103',
        role: 'rider',
        vendorId: null,
        zoneIds: ['kwamhlanga', 'kwaggafontein'],
      },
      {
        id: 'admin-001',
        name: 'Nomsa Dlamini',
        email: 'admin@kasieats.demo',
        phone: '071 555 0104',
        role: 'admin',
        vendorId: null,
        zoneIds: ['kwamhlanga', 'kwaggafontein'],
      },
    ]

    transaction(() => {
      users.forEach((user) => {
        run(
          `
            INSERT INTO users (id, name, email, phone, role, password_hash, vendor_id, zone_ids)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `,
          [
            user.id,
            user.name,
            user.email,
            user.phone,
            user.role,
            bcrypt.hashSync(demoPassword, 8),
            user.vendorId,
            JSON.stringify(user.zoneIds),
          ],
        )
      })
    })
  }

  const orderCount = get('SELECT COUNT(*) AS count FROM orders')?.count ?? 0

  if (orderCount === 0) {
    const seededOrders = [
      {
        id: 'KE-1301',
        customerId: 'customer-001',
        customerName: 'Thandeka Mabuza',
        phone: '071 555 0101',
        vendorId: 'spaza-flame-grill',
        zoneId: 'kwamhlanga',
        address: 'House 1122, Kwamhlanga A, near the blue gate',
        paymentMethod: 'cash',
        paymentStatus: 'cash_on_delivery',
        notes: 'Call at the gate when you arrive.',
        status: 'preparing',
        placedAtOffsetMinutes: 19,
        assignedRiderId: null,
        assignedRiderName: null,
        items: [
          { menuItemId: 'half-chicken-pap', quantity: 1 },
          { menuItemId: 'wings-loaded-fries', quantity: 1 },
        ],
      },
      {
        id: 'KE-1302',
        customerId: 'customer-001',
        customerName: 'Thandeka Mabuza',
        phone: '071 555 0101',
        vendorId: 'mam-lindiwe-kitchen',
        zoneId: 'kwaggafontein',
        address: 'Clinic road corner, Kwaggafontein Extension 6',
        paymentMethod: 'ewallet',
        paymentStatus: 'paid',
        notes: 'Use the side entrance next to the tuckshop.',
        status: 'ready',
        placedAtOffsetMinutes: 31,
        assignedRiderId: 'rider-001',
        assignedRiderName: 'Lebo Mokoena',
        items: [
          { menuItemId: 'beef-stew-plate', quantity: 2 },
          { menuItemId: 'lunchbox-combo', quantity: 1 },
        ],
      },
      {
        id: 'KE-1303',
        customerId: null,
        customerName: 'Sizwe Masilela',
        phone: '079 555 0199',
        vendorId: 'majita-burger-stop',
        zoneId: 'kwamhlanga',
        address: 'Sports field entrance, Kwamhlanga D',
        paymentMethod: 'card',
        paymentStatus: 'paid',
        notes: 'Meet at the gate by the floodlights.',
        status: 'on-route',
        placedAtOffsetMinutes: 24,
        assignedRiderId: 'rider-001',
        assignedRiderName: 'Lebo Mokoena',
        items: [
          { menuItemId: 'street-box', quantity: 1 },
          { menuItemId: 'double-cheese-burger', quantity: 1 },
        ],
      },
      {
        id: 'KE-1304',
        customerId: null,
        customerName: 'Ayanda Mokoena',
        phone: '072 555 0140',
        vendorId: 'nala-pizza-kota',
        zoneId: 'kwaggafontein',
        address: 'Main Road taxi rank pickup point',
        paymentMethod: 'cash',
        paymentStatus: 'cash_on_delivery',
        notes: 'Call when you reach the taxi lane.',
        status: 'placed',
        placedAtOffsetMinutes: 9,
        assignedRiderId: null,
        assignedRiderName: null,
        items: [
          { menuItemId: 'street-meat-pizza', quantity: 1 },
          { menuItemId: 'pizza-kota-pocket', quantity: 2 },
        ],
      },
      {
        id: 'KE-1305',
        customerId: null,
        customerName: 'Nomfundo Sikhakhane',
        phone: '078 555 0167',
        vendorId: 'spaza-flame-grill',
        zoneId: 'kwamhlanga',
        address: 'Taxi rank side gate, Kwamhlanga A',
        paymentMethod: 'card',
        paymentStatus: 'paid',
        notes: 'Drop by the side gate after the football practice crowd clears.',
        status: 'delivered',
        placedAtOffsetMinutes: 87,
        assignedRiderId: 'rider-001',
        assignedRiderName: 'Lebo Mokoena',
        items: [
          { menuItemId: 'family-grill-pack', quantity: 1 },
        ],
      },
    ]

    const vendorLookup = new Map(vendors.map((vendor) => [vendor.id, vendor]))

    transaction(() => {
      seededOrders.forEach((order) => {
        const vendor = vendorLookup.get(order.vendorId)
        const eta = order.zoneId === 'kwaggafontein' ? '28-36 min' : '22-30 min'
        const placedAt = new Date(Date.now() - order.placedAtOffsetMinutes * 60_000).toISOString()
        const lineItems = order.items.map((seededItem) => {
          const menuItem = vendor?.menu.find((item) => item.id === seededItem.menuItemId)

          if (!menuItem) {
            throw new Error(`Unable to seed menu item ${seededItem.menuItemId}.`)
          }

          return {
            id: randomUUID(),
            menuItemId: menuItem.id,
            name: menuItem.name,
            quantity: seededItem.quantity,
            price: menuItem.price,
            prepMinutes: menuItem.prepMinutes,
          }
        })

        const total =
          lineItems.reduce((sum, item) => sum + item.price * item.quantity, 0) + (vendor?.deliveryFee ?? 0)

        run(
          `
            INSERT INTO orders (
              id, customer_id, customer_name, phone, vendor_id, zone_id, address,
              payment_method, payment_status, notes, status, placed_at, eta,
              assigned_rider_id, assigned_rider_name, total
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `,
          [
            order.id,
            order.customerId,
            order.customerName,
            order.phone,
            order.vendorId,
            order.zoneId,
            order.address,
            order.paymentMethod,
            order.paymentStatus,
            order.notes,
            order.status,
            placedAt,
            eta,
            order.assignedRiderId,
            order.assignedRiderName,
            total,
          ],
        )

        lineItems.forEach((item) => {
          run(
            `
              INSERT INTO order_items (id, order_id, menu_item_id, name, quantity, price, prep_minutes)
              VALUES (?, ?, ?, ?, ?, ?, ?)
            `,
            [item.id, order.id, item.menuItemId, item.name, item.quantity, item.price, item.prepMinutes],
          )
        })
      })
    })
  }

  const pickupRequestCount = get('SELECT COUNT(*) AS count FROM pickup_requests')?.count ?? 0

  if (pickupRequestCount === 0) {
    const seededPickupRequests = [
      {
        id: 'KR-2101',
        customerId: 'customer-001',
        customerName: 'Thandeka Mabuza',
        phone: '071 555 0101',
        zoneId: 'kwamhlanga',
        pickupAddress: 'Kwamhlanga Plaza pharmacy counter',
        dropoffAddress: 'House 1122, Kwamhlanga A, near the blue gate',
        itemDescription: 'Collect chronic medication parcel already paid for.',
        paymentMethod: 'cash',
        paymentStatus: 'cash_on_delivery',
        notes: 'Please call when you reach the pharmacy queue.',
        status: 'accepted',
        requestedAtOffsetMinutes: 42,
        serviceFee: 35,
        assignedRiderId: 'rider-001',
        assignedRiderName: 'Lebo Mokoena',
      },
      {
        id: 'KR-2102',
        customerId: null,
        customerName: 'Ayanda Mokoena',
        phone: '072 555 0140',
        zoneId: 'kwaggafontein',
        pickupAddress: 'Main Road hardware store collection desk',
        dropoffAddress: 'Extension 6 community hall side gate',
        itemDescription: 'One bag of cement additives and a paint roller pickup.',
        paymentMethod: 'ewallet',
        paymentStatus: 'paid',
        notes: 'The store will release the parcel under Ayanda Mokoena.',
        status: 'requested',
        requestedAtOffsetMinutes: 14,
        serviceFee: 45,
        assignedRiderId: null,
        assignedRiderName: null,
      },
    ]

    transaction(() => {
      seededPickupRequests.forEach((request) => {
        run(
          `
            INSERT INTO pickup_requests (
              id, customer_id, customer_name, phone, zone_id, pickup_address, dropoff_address,
              item_description, payment_method, payment_status, notes, status, requested_at, eta,
              service_fee, assigned_rider_id, assigned_rider_name
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `,
          [
            request.id,
            request.customerId,
            request.customerName,
            request.phone,
            request.zoneId,
            request.pickupAddress,
            request.dropoffAddress,
            request.itemDescription,
            request.paymentMethod,
            request.paymentStatus,
            request.notes,
            request.status,
            new Date(Date.now() - request.requestedAtOffsetMinutes * 60_000).toISOString(),
            request.zoneId === 'kwaggafontein' ? '42-55 min' : '35-48 min',
            request.serviceFee,
            request.assignedRiderId,
            request.assignedRiderName,
          ],
        )
      })
    })
  }
}

seedDatabase()

export { all, db, get, mapVendorMenuItems, run, transaction }
