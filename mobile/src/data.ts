import type {
  DemoCredential,
  OrderSeed,
  PickupRequestSeed,
  ServiceStat,
  SessionUser,
  UserRole,
  Vendor,
  Zone,
} from './types'

export const zones: Zone[] = [
  {
    id: 'kwamhlanga',
    name: 'Kwamhlanga',
    eta: '18-28 min',
    coverage: 'A, B, D and the school corridors',
  },
  {
    id: 'kwaggafontein',
    name: 'Kwaggafontein',
    eta: '24-34 min',
    coverage: 'Main road, extensions, and taxi-rank pickups',
  },
]

export const stats: ServiceStat[] = [
  {
    id: 'riders',
    label: 'Riders',
    value: '32',
    detail: 'Shared across lunch and supper runs.',
  },
  {
    id: 'arrival',
    label: 'Average ETA',
    value: '23 min',
    detail: 'Built around grouped township routes.',
  },
  {
    id: 'rating',
    label: 'Neighbour rating',
    value: '4.8 / 5',
    detail: 'Clear drop points are helping trust.',
  },
]

export const demoCredentials: DemoCredential[] = [
  {
    role: 'customer',
    email: 'customer@kasieats.demo',
    password: 'Welcome123!',
    label: 'Customer',
    summary: 'Place food orders or request a driver pickup to your gate or pickup point.',
  },
  {
    role: 'vendor',
    email: 'vendor@kasieats.demo',
    password: 'Welcome123!',
    label: 'Vendor',
    summary: 'Watch queue pressure and mark food ready for riders.',
  },
  {
    role: 'rider',
    email: 'rider@kasieats.demo',
    password: 'Welcome123!',
    label: 'Rider',
    summary: 'Take ready meals and pickup requests on-route, then close delivery loops quickly.',
  },
  {
    role: 'admin',
    email: 'admin@kasieats.demo',
    password: 'Welcome123!',
    label: 'Admin',
    summary: 'See cross-role metrics and the live service pulse.',
  },
]

export const fallbackUsers: Record<UserRole, SessionUser> = {
  customer: {
    id: 'customer-001',
    name: 'Thandeka Mabuza',
    email: 'customer@kasieats.demo',
    phone: '071 555 0101',
    role: 'customer',
    zoneIds: ['kwamhlanga'],
  },
  vendor: {
    id: 'vendor-001',
    name: 'Bongani Nkosi',
    email: 'vendor@kasieats.demo',
    phone: '071 555 0102',
    role: 'vendor',
    vendorId: 'spaza-flame-grill',
  },
  rider: {
    id: 'rider-001',
    name: 'Lebo Mokoena',
    email: 'rider@kasieats.demo',
    phone: '071 555 0103',
    role: 'rider',
    zoneIds: ['kwamhlanga', 'kwaggafontein'],
  },
  admin: {
    id: 'admin-001',
    name: 'Nomsa Dlamini',
    email: 'admin@kasieats.demo',
    phone: '071 555 0104',
    role: 'admin',
    zoneIds: ['kwamhlanga', 'kwaggafontein'],
  },
}

export const vendors: Vendor[] = [
  {
    id: 'spaza-flame-grill',
    name: 'Spaza Flame Grill',
    area: 'Kwamhlanga A',
    tagline: 'Late grill plates, loaded chips, and kota favourites.',
    description: 'Fire-grilled comfort food that moves fast during supper rush.',
    rating: 4.9,
    eta: '18-26 min',
    deliveryFee: 18,
    heroLabel: 'SFG',
    spotlight: '#f97316',
    zoneIds: ['kwamhlanga', 'kwaggafontein'],
    categories: ['Shisanyama', 'Kota', 'Street grill'],
    coverImageUrl:
      'https://images.unsplash.com/photo-1550547660-d9450f859349?auto=format&fit=crop&w=1200&q=80',
    galleryImageUrls: [
      'https://images.unsplash.com/photo-1550547660-d9450f859349?auto=format&fit=crop&w=1200&q=80',
      'https://images.unsplash.com/photo-1600891964092-4316c288032e?auto=format&fit=crop&w=1200&q=80',
      'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?auto=format&fit=crop&w=1200&q=80',
    ],
    signatureDish: 'Firecracker Kota',
    deliveryNote: 'Best for grill nights, friend groups, and quick supper runs.',
    menu: [
      {
        id: 'half-chicken-pap',
        name: 'Half Chicken and Pap',
        description: 'Fire-grilled half chicken with chakalaka and soft pap.',
        price: 95,
        prepMinutes: 20,
        badge: 'Top seller',
        imageUrl:
          'https://images.unsplash.com/photo-1600891964092-4316c288032e?auto=format&fit=crop&w=900&q=80',
      },
      {
        id: 'kota-firecracker',
        name: 'Firecracker Kota',
        description: 'Polony, chips, egg, achar, Russian, and house chilli sauce.',
        price: 68,
        prepMinutes: 14,
        badge: 'Signature',
        imageUrl:
          'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?auto=format&fit=crop&w=900&q=80',
      },
      {
        id: 'wings-loaded-fries',
        name: 'Wings and Loaded Fries',
        description: 'Sticky wings on masala fries with creamy slaw.',
        price: 82,
        prepMinutes: 16,
        imageUrl:
          'https://images.unsplash.com/photo-1527477396000-e27163b481c2?auto=format&fit=crop&w=900&q=80',
      },
    ],
  },
  {
    id: 'mam-lindiwe-kitchen',
    name: 'Mam Lindiwe Kitchen',
    area: 'Kwaggafontein Extension 6',
    tagline: 'Home-style plates for lunchboxes and supper tables.',
    description: 'Big portions and stew bowls that travel well around the neighbourhood.',
    rating: 4.8,
    eta: '22-32 min',
    deliveryFee: 20,
    heroLabel: 'MLK',
    spotlight: '#b45309',
    zoneIds: ['kwaggafontein', 'kwamhlanga'],
    categories: ['Home plates', 'Stew bowls', 'Lunch specials'],
    coverImageUrl:
      'https://images.unsplash.com/photo-1547592180-85f173990554?auto=format&fit=crop&w=1200&q=80',
    galleryImageUrls: [
      'https://images.unsplash.com/photo-1547592180-85f173990554?auto=format&fit=crop&w=1200&q=80',
      'https://images.unsplash.com/photo-1512058564366-18510be2db19?auto=format&fit=crop&w=1200&q=80',
      'https://images.unsplash.com/photo-1516684732162-798a0062be99?auto=format&fit=crop&w=1200&q=80',
    ],
    signatureDish: 'Beef Stew Plate',
    deliveryNote: 'Warm family-style meals with fuller portions for lunch and supper.',
    menu: [
      {
        id: 'beef-stew-plate',
        name: 'Beef Stew Plate',
        description: 'Tender beef stew with rice, pumpkin, and spinach.',
        price: 89,
        prepMinutes: 18,
        badge: 'Comfort meal',
        imageUrl:
          'https://images.unsplash.com/photo-1512058564366-18510be2db19?auto=format&fit=crop&w=900&q=80',
      },
      {
        id: 'samp-beans-bowl',
        name: 'Samp and Beans Bowl',
        description: 'Creamy samp mix with grilled chicken strips and gravy.',
        price: 74,
        prepMinutes: 17,
        imageUrl:
          'https://images.unsplash.com/photo-1516684732162-798a0062be99?auto=format&fit=crop&w=900&q=80',
      },
      {
        id: 'lunchbox-combo',
        name: 'Lunchbox Combo',
        description: 'Pap, chicken stew, beetroot, and cabbage for school or work.',
        price: 69,
        prepMinutes: 15,
        badge: 'Lunch hero',
        imageUrl:
          'https://images.unsplash.com/photo-1504674900247-0877df9cc836?auto=format&fit=crop&w=900&q=80',
      },
    ],
  },
  {
    id: 'majita-burger-stop',
    name: 'Majita Burger Stop',
    area: 'Kwamhlanga D',
    tagline: 'Burgers, slap chips, and fast night snacks.',
    description: 'Snack boxes and burgers for sports-field cravings and late pickups.',
    rating: 4.7,
    eta: '16-24 min',
    deliveryFee: 16,
    heroLabel: 'MBS',
    spotlight: '#0f766e',
    zoneIds: ['kwamhlanga'],
    categories: ['Burgers', 'Wraps', 'Snack boxes'],
    coverImageUrl:
      'https://images.unsplash.com/photo-1513104890138-7c749659a591?auto=format&fit=crop&w=1200&q=80',
    galleryImageUrls: [
      'https://images.unsplash.com/photo-1513104890138-7c749659a591?auto=format&fit=crop&w=1200&q=80',
      'https://images.unsplash.com/photo-1550317138-10000687a72b?auto=format&fit=crop&w=1200&q=80',
      'https://images.unsplash.com/photo-1571091718767-18b5b1457add?auto=format&fit=crop&w=1200&q=80',
    ],
    signatureDish: 'Double Cheese Burger',
    deliveryNote: 'Fast snacks for sports fields, after-school pickups, and late cravings.',
    menu: [
      {
        id: 'double-cheese-burger',
        name: 'Double Cheese Burger',
        description: 'Two beef patties, melty cheese, slap chips, and smoked mayo.',
        price: 78,
        prepMinutes: 12,
        badge: 'Fast mover',
        imageUrl:
          'https://images.unsplash.com/photo-1550317138-10000687a72b?auto=format&fit=crop&w=900&q=80',
      },
      {
        id: 'street-box',
        name: 'Street Snack Box',
        description: 'Mini burger, wings, fries, and a cold drink.',
        price: 99,
        prepMinutes: 15,
        badge: 'Crew combo',
        imageUrl:
          'https://images.unsplash.com/photo-1571091718767-18b5b1457add?auto=format&fit=crop&w=900&q=80',
      },
      {
        id: 'masala-fries',
        name: 'Masala Fries Tub',
        description: 'Crisp chips tossed with masala spice and garlic sauce.',
        price: 38,
        prepMinutes: 8,
        imageUrl:
          'https://images.unsplash.com/photo-1630384060421-cb20d0e0649d?auto=format&fit=crop&w=900&q=80',
      },
    ],
  },
]

export const seedOrders: OrderSeed[] = [
  {
    id: 'KE-1301',
    customerId: 'customer-001',
    customerName: 'Thandeka Mabuza',
    vendorId: 'spaza-flame-grill',
    zoneId: 'kwamhlanga',
    address: 'House 1122, Kwamhlanga A, near the blue gate',
    paymentMethod: 'cash',
    notes: 'Call at the gate when you arrive.',
    total: 195,
    eta: '22-30 min',
    status: 'preparing',
    assignedRiderName: null,
    items: [
      { id: 'half-chicken-pap', name: 'Half Chicken and Pap', quantity: 1, price: 95 },
      { id: 'wings-loaded-fries', name: 'Wings and Loaded Fries', quantity: 1, price: 82 },
    ],
  },
  {
    id: 'KE-1302',
    customerId: 'customer-001',
    customerName: 'Thandeka Mabuza',
    vendorId: 'mam-lindiwe-kitchen',
    zoneId: 'kwaggafontein',
    address: 'Clinic road corner, Kwaggafontein Extension 6',
    paymentMethod: 'ewallet',
    notes: 'Use the side entrance next to the tuckshop.',
    total: 267,
    eta: '28-36 min',
    status: 'ready',
    assignedRiderName: 'Lebo Mokoena',
    items: [
      { id: 'beef-stew-plate', name: 'Beef Stew Plate', quantity: 2, price: 89 },
      { id: 'lunchbox-combo', name: 'Lunchbox Combo', quantity: 1, price: 69 },
    ],
  },
  {
    id: 'KE-1303',
    customerId: null,
    customerName: 'Sizwe Masilela',
    vendorId: 'majita-burger-stop',
    zoneId: 'kwamhlanga',
    address: 'Sports field entrance, Kwamhlanga D',
    paymentMethod: 'card',
    notes: 'Meet at the gate by the floodlights.',
    total: 193,
    eta: '22-30 min',
    status: 'on-route',
    assignedRiderName: 'Lebo Mokoena',
    items: [
      { id: 'street-box', name: 'Street Snack Box', quantity: 1, price: 99 },
      { id: 'double-cheese-burger', name: 'Double Cheese Burger', quantity: 1, price: 78 },
    ],
  },
]

export const seedPickupRequests: PickupRequestSeed[] = [
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
    notes: 'Please call when you reach the pharmacy queue.',
    serviceFee: 35,
    eta: '35-48 min',
    status: 'accepted',
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
    serviceFee: 45,
    eta: '42-55 min',
    status: 'requested',
    assignedRiderName: null,
  },
]
