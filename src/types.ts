export type ZoneId = 'kwamhlanga' | 'kwaggafontein'
export type UserRole = 'customer' | 'vendor' | 'rider' | 'admin'
export type OrderStatus = 'placed' | 'accepted' | 'preparing' | 'ready' | 'on-route' | 'delivered'
export type PickupRequestStatus = 'requested' | 'accepted' | 'collecting' | 'on-route' | 'delivered'
export type PaymentStatus = 'pending' | 'paid' | 'cash_on_delivery' | 'failed' | 'cancelled'
export type TrackingState = 'done' | 'current' | 'todo'

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

export interface PickupRequestFormState {
  customerName: string
  phone: string
  zoneId: ZoneId
  pickupAddress: string
  dropoffAddress: string
  itemDescription: string
  notes: string
  paymentMethod: 'cash' | 'ewallet'
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
  successUrl?: string
  cancelUrl?: string
  items: OrderSubmissionItem[]
}

export interface PickupRequestSubmission {
  customerName: string
  phone: string
  zoneId: ZoneId
  pickupAddress: string
  dropoffAddress: string
  itemDescription: string
  notes: string
  paymentMethod: PickupRequestFormState['paymentMethod']
}

export interface TrackingStep {
  id: OrderStatus | PickupRequestStatus
  label: string
  state: TrackingState
}

export interface OrderLine {
  id: string
  name: string
  quantity: number
  price: number
  prepMinutes: number
}

export interface OrderRecord {
  taskType: 'order'
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
  deliveryFee: number
  eta: string
  status: OrderStatus
  statusLabel: string
  placedAt: string
  assignedRiderName: string | null
  trackingSteps: TrackingStep[]
  allowedNextStatuses: OrderStatus[]
  items: OrderLine[]
  message?: string
}

export interface PickupRequestRecord {
  taskType: 'pickup'
  requestId: string
  customerName: string
  phone: string
  zoneId: ZoneId
  zoneName: string
  pickupAddress: string
  dropoffAddress: string
  itemDescription: string
  paymentMethod: PickupRequestFormState['paymentMethod']
  paymentStatus: PaymentStatus
  paymentStatusLabel: string
  notes: string
  serviceFee: number
  eta: string
  status: PickupRequestStatus
  statusLabel: string
  requestedAt: string
  assignedRiderName: string | null
  trackingSteps: TrackingStep[]
  allowedNextStatuses: PickupRequestStatus[]
  message?: string
}

export type DispatchRecord = OrderRecord | PickupRequestRecord

export interface SessionUser {
  id: string
  name: string
  email: string
  phone: string
  role: UserRole
  vendorId?: string
  zoneIds?: ZoneId[]
}

export interface AuthSession {
  token: string
  user: SessionUser
}

export interface DemoCredential {
  role: UserRole
  label: string
  email: string
  password: string
  summary: string
  accent: string
}

export interface RoleHighlight {
  role: UserRole
  title: string
  summary: string
  capabilities: string[]
  accent: string
}

export interface CustomerDashboard {
  customerName: string
  savedZone: string
  loyaltyNote: string
  orders: OrderRecord[]
  pickupRequests: PickupRequestRecord[]
}

export interface VendorTopItem {
  name: string
  orders: number
}

export interface VendorDashboard {
  vendorId: string
  vendorName: string
  queueCount: number
  readyCount: number
  avgPrepTime: number
  topItems: VendorTopItem[]
  liveOrders: OrderRecord[]
}

export interface RiderDashboard {
  riderName: string
  assignedCount: number
  completedToday: number
  earningsToday: number
  tasks: DispatchRecord[]
}

export interface AdminStage {
  status: OrderStatus | PickupRequestStatus
  label: string
  count: number
}

export interface AdminOverview {
  activeOrders: number
  activePickupRequests: number
  deliveredToday: number
  revenueToday: number
  vendorsOnline: number
  ridersLive: number
  pendingIssues: string[]
  orderStages: AdminStage[]
  pickupStages: AdminStage[]
  liveTasks: DispatchRecord[]
  headline: string
}
