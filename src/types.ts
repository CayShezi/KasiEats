export type ZoneId = 'kwamhlanga' | 'kwaggafontein'

export interface Zone {
  id: ZoneId
  name: string
  eta: string
  coverage: string
  blurb: string
}

export interface MenuItem {
  id: string
  name: string
  description: string
  price: number
  prepMinutes: number
  badge?: string
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
  menu: MenuItem[]
}

export interface ServiceStat {
  id: string
  label: string
  value: string
  detail: string
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

export interface OrderSubmissionItem {
  vendorId: string
  menuItemId: string
  quantity: number
}

export interface OrderSubmission {
  customerName: string
  phone: string
  address: string
  zoneId: ZoneId
  notes: string
  paymentMethod: OrderFormState['paymentMethod']
  items: OrderSubmissionItem[]
}

export interface OrderResponse {
  orderId: string
  eta: string
  message: string
  trackingSteps: string[]
}
