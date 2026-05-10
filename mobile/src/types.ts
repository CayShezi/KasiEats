export type TabId = 'discover' | 'basket' | 'ops' | 'profile'
export type ZoneId = 'kwamhlanga' | 'kwaggafontein'
export type UserRole = 'customer' | 'vendor' | 'rider' | 'admin'
export type OrderStatus = 'placed' | 'accepted' | 'preparing' | 'ready' | 'on-route' | 'delivered'
export type PaymentStatus = 'pending' | 'paid' | 'cash_on_delivery' | 'failed' | 'cancelled'
export type TrackingState = 'done' | 'current' | 'todo'

export interface Zone {
  id: ZoneId
  name: string
  eta: string
  coverage: string
}

export interface ServiceStat {
  id: string
  label: string
  value: string
  detail: string
}

export interface MenuItem {
  id: string
  name: string
  description: string
  price: number
  prepMinutes: number
  badge?: string
  imageUrl?: string
}

export interface Vendor {
  id: string
  name: string
  area: string
  tagline: string
  description: string
  rating: number
  eta: string
  deliveryFee: number
  heroLabel: string
  spotlight: string
  zoneIds: ZoneId[]
  categories: string[]
  coverImageUrl?: string
  galleryImageUrls?: string[]
  signatureDish?: string
  deliveryNote?: string
  menu: MenuItem[]
}

export interface BasketEntry {
  vendorId: string
  item: MenuItem
  quantity: number
}

export interface OrderFormState {
  customerName: string
  phone: string
  address: string
  zoneId: ZoneId
  notes: string
  paymentMethod: 'cash' | 'card' | 'ewallet'
}

export interface SessionUser {
  id: string
  name: string
  email: string
  phone: string
  role: UserRole
  vendorId?: string
  zoneIds?: ZoneId[]
}

export interface DemoCredential {
  role: UserRole
  email: string
  password: string
  label: string
  summary: string
}

export interface TrackingStep {
  id: OrderStatus
  label: string
  state: TrackingState
}

export interface OrderLine {
  id: string
  name: string
  quantity: number
  price: number
  prepMinutes?: number
}

export interface OrderRecord {
  orderId: string
  customerName: string
  vendorId: string
  vendorName: string
  zoneId: ZoneId
  zoneName: string
  address: string
  paymentMethod: OrderFormState['paymentMethod']
  paymentStatus: PaymentStatus
  paymentStatusLabel: string
  paymentUrl: string | null
  notes: string
  total: number
  eta: string
  status: OrderStatus
  statusLabel: string
  assignedRiderName: string | null
  trackingSteps: TrackingStep[]
  allowedNextStatuses: OrderStatus[]
  items: OrderLine[]
  placedAt?: string
  message?: string
}

export interface OrderSeed {
  id: string
  customerId: string | null
  customerName: string
  vendorId: string
  zoneId: ZoneId
  address: string
  paymentMethod: OrderFormState['paymentMethod']
  paymentStatus?: PaymentStatus
  notes: string
  total: number
  eta: string
  status: OrderStatus
  assignedRiderName: string | null
  items: OrderLine[]
}
