import { StatusBar } from 'expo-status-bar'
import Constants from 'expo-constants'
import * as Device from 'expo-device'
import * as Notifications from 'expo-notifications'
import { useEffect, useMemo, useState } from 'react'
import {
  Image,
  ImageBackground,
  Linking,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { demoCredentials, fallbackUsers, seedOrders, stats as seedStats, vendors as seedVendors, zones } from './src/data'
import type {
  BasketEntry,
  DemoCredential,
  OrderFormState,
  OrderRecord,
  OrderSeed,
  OrderStatus,
  SessionUser,
  TabId,
  TrackingStep,
  UserRole,
  Vendor,
  ZoneId,
} from './src/types'

const currency = new Intl.NumberFormat('en-ZA', {
  style: 'currency',
  currency: 'ZAR',
  maximumFractionDigits: 0,
})

const apiBaseUrl = process.env.EXPO_PUBLIC_API_BASE_URL?.replace(/\/$/, '') ?? ''
const publicWebUrl = process.env.EXPO_PUBLIC_WEB_URL?.replace(/\/$/, '') ?? ''
const expoProjectId = process.env.EXPO_PUBLIC_EXPO_PROJECT_ID?.trim() ?? ''
const defaultZone = zones[0]?.id ?? 'kwamhlanga'
const emptyOrderForm: OrderFormState = {
  customerName: '',
  phone: '',
  address: '',
  zoneId: defaultZone,
  notes: '',
  paymentMethod: 'cash',
}
const statusSequence: OrderStatus[] = ['placed', 'accepted', 'preparing', 'ready', 'on-route', 'delivered']
const statusLabels: Record<OrderStatus, string> = {
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
const vendorSortOptions = [
  { id: 'trending', label: 'Trending' },
  { id: 'rating', label: 'Top rated' },
  { id: 'fastest', label: 'Fastest' },
  { id: 'delivery', label: 'Lowest fee' },
] as const
const roleTransitions: Record<UserRole, Partial<Record<OrderStatus, OrderStatus>>> = {
  customer: {},
  vendor: {
    placed: 'accepted',
    accepted: 'preparing',
    preparing: 'ready',
  },
  rider: {
    ready: 'on-route',
    'on-route': 'delivered',
  },
  admin: {
    placed: 'accepted',
    accepted: 'preparing',
    preparing: 'ready',
    ready: 'on-route',
    'on-route': 'delivered',
  },
}

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
})

function estimateEtaMinutes(eta: string) {
  const match = eta.match(/\d+/)
  return match ? Number(match[0]) : 999
}

function mergeVendorVisuals(remoteVendors: Vendor[]) {
  return remoteVendors.map((remoteVendor) => {
    const fallbackVendor = seedVendors.find((vendor) => vendor.id === remoteVendor.id)

    if (!fallbackVendor) {
      return remoteVendor
    }

    return {
      ...fallbackVendor,
      ...remoteVendor,
      coverImageUrl: remoteVendor.coverImageUrl ?? fallbackVendor.coverImageUrl,
      galleryImageUrls: remoteVendor.galleryImageUrls ?? fallbackVendor.galleryImageUrls,
      signatureDish: remoteVendor.signatureDish ?? fallbackVendor.signatureDish,
      deliveryNote: remoteVendor.deliveryNote ?? fallbackVendor.deliveryNote,
      menu: remoteVendor.menu.map((item) => {
        const fallbackItem = fallbackVendor.menu.find((menuItem) => menuItem.id === item.id)

        return {
          ...fallbackItem,
          ...item,
          imageUrl: item.imageUrl ?? fallbackItem?.imageUrl,
        }
      }),
    }
  })
}

function buildTrackingSteps(status: OrderStatus): TrackingStep[] {
  const currentIndex = statusSequence.indexOf(status)

  return statusSequence.map((step, index) => ({
    id: step,
    label: statusLabels[step],
    state: index < currentIndex ? 'done' : index === currentIndex ? 'current' : 'todo',
  }))
}

function materializeOrders(orderSeeds: OrderSeed[], role: UserRole = 'customer'): OrderRecord[] {
  return orderSeeds.map((order) => {
    const vendor = seedVendors.find((item) => item.id === order.vendorId) ?? seedVendors[0]
    const zone = zones.find((item) => item.id === order.zoneId) ?? zones[0]
    const nextStatus = roleTransitions[role][order.status]
    const paymentStatus: OrderRecord['paymentStatus'] =
      order.paymentStatus ??
      (order.paymentMethod === 'cash' ? 'cash_on_delivery' : order.paymentMethod === 'card' ? 'pending' : 'paid')

    return {
      orderId: order.id,
      customerName: order.customerName,
      vendorId: order.vendorId,
      vendorName: vendor.name,
      zoneId: order.zoneId,
      zoneName: zone.name,
      address: order.address,
      paymentMethod: order.paymentMethod,
      paymentStatus,
      paymentStatusLabel: paymentStatusLabels[paymentStatus],
      paymentUrl: null,
      notes: order.notes,
      total: order.total,
      eta: order.eta,
      status: order.status,
      statusLabel: statusLabels[order.status],
      assignedRiderName: order.assignedRiderName,
      trackingSteps: buildTrackingSteps(order.status),
      allowedNextStatuses: nextStatus ? [nextStatus] : [],
      items: order.items,
    }
  })
}

function createLocalOrder(orderForm: OrderFormState, vendor: Vendor, basket: BasketEntry[], session: SessionUser | null) {
  const zone = zones.find((item) => item.id === orderForm.zoneId) ?? zones[0]
  const subtotal = basket.reduce((sum, entry) => sum + entry.item.price * entry.quantity, 0)
  const paymentStatus: OrderRecord['paymentStatus'] =
    orderForm.paymentMethod === 'cash'
      ? 'cash_on_delivery'
      : orderForm.paymentMethod === 'card'
        ? 'pending'
        : 'paid'

  return {
    orderId: `KE-M-${Math.floor(1000 + Math.random() * 9000)}`,
    customerName: orderForm.customerName || session?.name || 'Walk-in customer',
    vendorId: vendor.id,
    vendorName: vendor.name,
    zoneId: zone.id,
    zoneName: zone.name,
    address: orderForm.address,
    paymentMethod: orderForm.paymentMethod,
    paymentStatus,
    paymentStatusLabel: paymentStatusLabels[paymentStatus],
    paymentUrl: null,
    notes: orderForm.notes,
    total: subtotal + vendor.deliveryFee,
    eta: zone.id === 'kwaggafontein' ? '28-36 min' : '22-30 min',
    status: 'placed' as OrderStatus,
    statusLabel: statusLabels.placed,
    assignedRiderName: null,
    trackingSteps: buildTrackingSteps('placed'),
    allowedNextStatuses: [],
    items: basket.map((entry) => ({
      id: entry.item.id,
      name: entry.item.name,
      quantity: entry.quantity,
      price: entry.item.price,
    })),
  }
}

function computeRoleOrders(role: UserRole, session: SessionUser | null, orders: OrderRecord[]) {
  if (!session) {
    return []
  }

  if (role === 'customer') {
    return orders.filter((order) => order.customerName === session.name)
  }

  if (role === 'vendor') {
    return orders.filter((order) => order.vendorId === session.vendorId)
  }

  if (role === 'rider') {
    return orders.filter(
      (order) =>
        session.zoneIds?.includes(order.zoneId) &&
        (order.assignedRiderName === session.name ||
          order.status === 'ready' ||
          order.status === 'on-route'),
    )
  }

  return orders
}

function getRoleSummary(role: UserRole | null, session: SessionUser | null, orders: OrderRecord[]) {
  if (!role || !session) {
    return {
      headline: 'Choose a demo role to unlock operations',
      metrics: [],
    }
  }

  const filtered = computeRoleOrders(role, session, orders)

  if (role === 'customer') {
    return {
      headline: `Welcome back, ${session.name}`,
      metrics: [
        { label: 'Orders', value: String(filtered.length) },
        { label: 'Saved zone', value: session.zoneIds?.[0] ?? 'kwamhlanga' },
        { label: 'Mode', value: apiBaseUrl ? 'Live / demo' : 'Offline demo' },
      ],
    }
  }

  if (role === 'vendor') {
    return {
      headline: 'Kitchen queue',
      metrics: [
        {
          label: 'Queue',
          value: String(filtered.filter((order) => ['placed', 'accepted', 'preparing'].includes(order.status)).length),
        },
        { label: 'Ready', value: String(filtered.filter((order) => order.status === 'ready').length) },
        { label: 'Live orders', value: String(filtered.filter((order) => order.status !== 'delivered').length) },
      ],
    }
  }

  if (role === 'rider') {
    return {
      headline: 'Route dispatch',
      metrics: [
        { label: 'Assigned', value: String(filtered.length) },
        { label: 'On route', value: String(filtered.filter((order) => order.status === 'on-route').length) },
        { label: 'Done today', value: String(filtered.filter((order) => order.status === 'delivered').length) },
      ],
    }
  }

  return {
    headline: 'Operations pulse',
    metrics: [
      { label: 'Active', value: String(orders.filter((order) => order.status !== 'delivered').length) },
      { label: 'Delivered', value: String(orders.filter((order) => order.status === 'delivered').length) },
      {
        label: 'Revenue',
        value: currency.format(orders.reduce((sum, order) => sum + order.total, 0)),
      },
    ],
  }
}

async function readResponseMessage(response: Response) {
  try {
    const payload = (await response.json()) as { message?: string }
    return payload.message ?? `Request failed with status ${response.status}.`
  } catch {
    return `Request failed with status ${response.status}.`
  }
}

async function registerForPushNotificationsAsync() {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('orders', {
      name: 'orders',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#ea580c',
    })
  }

  if (!Device.isDevice) {
    return {
      token: null,
      platform: Platform.OS,
      message: 'Push notifications need a physical device or supported simulator build.',
    }
  }

  const projectId =
    expoProjectId || Constants.expoConfig?.extra?.eas?.projectId || Constants.easConfig?.projectId || ''

  if (!projectId) {
    return {
      token: null,
      platform: Platform.OS,
      message: 'Set EXPO_PUBLIC_EXPO_PROJECT_ID before registering Expo push notifications.',
    }
  }

  const existingPermissions = await Notifications.getPermissionsAsync()
  let finalStatus = existingPermissions.status

  if (finalStatus !== 'granted') {
    finalStatus = (await Notifications.requestPermissionsAsync()).status
  }

  if (finalStatus !== 'granted') {
    return {
      token: null,
      platform: Platform.OS,
      message: 'Push notifications were not permitted on this device.',
    }
  }

  const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data

  return {
    token,
    platform: Platform.OS,
    message: 'Push notifications are active for this signed-in device.',
  }
}

export default function App() {
  const [activeTab, setActiveTab] = useState<TabId>('discover')
  const [session, setSession] = useState<SessionUser | null>(null)
  const [token, setToken] = useState<string | null>(null)
  const [vendors, setVendors] = useState(seedVendors)
  const [stats, setStats] = useState(seedStats)
  const [orders, setOrders] = useState<OrderRecord[]>(materializeOrders(seedOrders))
  const [activeZone, setActiveZone] = useState<ZoneId>(defaultZone)
  const [search, setSearch] = useState('')
  const [vendorSort, setVendorSort] = useState<(typeof vendorSortOptions)[number]['id']>('trending')
  const [selectedVendorId, setSelectedVendorId] = useState(seedVendors[0]?.id ?? '')
  const [basket, setBasket] = useState<BasketEntry[]>([])
  const [orderForm, setOrderForm] = useState<OrderFormState>(emptyOrderForm)
  const [lastOrder, setLastOrder] = useState<OrderRecord | null>(null)
  const [serviceOnline, setServiceOnline] = useState(false)
  const [message, setMessage] = useState(
    apiBaseUrl
      ? 'Connecting to live API and falling back to offline demo if needed.'
      : 'Offline demo mode active until EXPO_PUBLIC_API_BASE_URL is configured.',
  )
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let ignore = false

    async function loadMarketplace() {
      if (!apiBaseUrl) {
        return
      }

      try {
        const response = await fetch(`${apiBaseUrl}/api/marketplace`)

        if (!response.ok) {
          throw new Error(await readResponseMessage(response))
        }

        const payload = (await response.json()) as { vendors: Vendor[]; stats: typeof seedStats }

        if (!ignore) {
          setVendors(mergeVendorVisuals(payload.vendors))
          setStats(payload.stats)
          setServiceOnline(true)
          setMessage('Live API connected. Mobile app can use real marketplace data.')
        }
      } catch {
        if (!ignore) {
          setServiceOnline(false)
          setMessage('API unreachable. Mobile app is using the built-in local demo flow.')
        }
      }
    }

    void loadMarketplace()

    return () => {
      ignore = true
    }
  }, [])

  useEffect(() => {
    const receivedSubscription = Notifications.addNotificationReceivedListener((notification) => {
      const title = notification.request.content.title ?? 'Dispatch update'
      const body = notification.request.content.body ?? 'Your KasiEats order has a new update.'
      setMessage(`${title}: ${body}`)
    })
    const responseSubscription = Notifications.addNotificationResponseReceivedListener(() => {
      setActiveTab('ops')
    })

    return () => {
      receivedSubscription.remove()
      responseSubscription.remove()
    }
  }, [])

  useEffect(() => {
    let ignore = false

    async function registerPushDevice() {
      if (!apiBaseUrl || !token || !session) {
        return
      }

      try {
        const registration = await registerForPushNotificationsAsync()

        if (!registration.token) {
          if (!ignore) {
            setMessage(registration.message)
          }
          return
        }

        const platform =
          registration.platform === 'ios' ? 'ios' : registration.platform === 'android' ? 'android' : 'web'
        const response = await fetch(`${apiBaseUrl}/api/push/register`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            token: registration.token,
            platform,
          }),
        })

        if (!response.ok) {
          throw new Error(await readResponseMessage(response))
        }

        if (!ignore) {
          setMessage(registration.message)
        }
      } catch (error) {
        if (!ignore) {
          setMessage(error instanceof Error ? error.message : 'Push registration failed.')
        }
      }
    }

    void registerPushDevice()

    return () => {
      ignore = true
    }
  }, [session, token])

  const filteredVendors = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase()

    const visible = vendors.filter((vendor) => {
      const matchesZone = vendor.zoneIds.includes(activeZone)

      if (!normalizedSearch) {
        return matchesZone
      }

      const haystack = [
        vendor.name,
        vendor.tagline,
        vendor.description,
        vendor.categories.join(' '),
        vendor.signatureDish ?? '',
        vendor.menu.map((item) => `${item.name} ${item.description}`).join(' '),
      ]
        .join(' ')
        .toLowerCase()

      return matchesZone && haystack.includes(normalizedSearch)
    })

    return [...visible].sort((left, right) => {
      if (vendorSort === 'rating') {
        return right.rating - left.rating
      }

      if (vendorSort === 'fastest') {
        return estimateEtaMinutes(left.eta) - estimateEtaMinutes(right.eta)
      }

      if (vendorSort === 'delivery') {
        return left.deliveryFee - right.deliveryFee
      }

      const leftScore = left.rating * 10 - left.deliveryFee - estimateEtaMinutes(left.eta)
      const rightScore = right.rating * 10 - right.deliveryFee - estimateEtaMinutes(right.eta)
      return rightScore - leftScore
    })
  }, [activeZone, search, vendorSort, vendors])

  const selectedVendor =
    filteredVendors.find((vendor) => vendor.id === selectedVendorId) ??
    filteredVendors[0] ??
    vendors.find((vendor) => vendor.id === selectedVendorId) ??
    vendors[0]

  const basketVendor =
    (basket[0] && vendors.find((vendor) => vendor.id === basket[0].vendorId)) || selectedVendor

  const subtotal = basket.reduce((sum, entry) => sum + entry.item.price * entry.quantity, 0)
  const deliveryFee = basket.length > 0 && basketVendor ? basketVendor.deliveryFee : 0
  const total = subtotal + deliveryFee
  const roleOrders = computeRoleOrders(session?.role ?? 'customer', session, orders)
  const roleSummary = getRoleSummary(session?.role ?? null, session, orders)
  const selectedVendorGallery =
    selectedVendor?.galleryImageUrls?.length ? selectedVendor.galleryImageUrls : selectedVendor?.coverImageUrl ? [selectedVendor.coverImageUrl] : []

  const addToBasket = (vendor: Vendor, itemId: string) => {
    const item = vendor.menu.find((menuItem) => menuItem.id === itemId)

    if (!item) {
      return
    }

    setBasket((current) => {
      const switchingVendor = current.length > 0 && current[0].vendorId !== vendor.id

      if (switchingVendor) {
        return [{ vendorId: vendor.id, item, quantity: 1 }]
      }

      const existing = current.find((entry) => entry.item.id === item.id)

      if (!existing) {
        return [...current, { vendorId: vendor.id, item, quantity: 1 }]
      }

      return current.map((entry) =>
        entry.item.id === item.id ? { ...entry, quantity: entry.quantity + 1 } : entry,
      )
    })

    setSelectedVendorId(vendor.id)
    setActiveTab('basket')
    setMessage(`${item.name} added to basket.`)
  }

  const loginWithCredential = async (credential: DemoCredential) => {
    setBusy(true)

    try {
      if (apiBaseUrl) {
        const response = await fetch(`${apiBaseUrl}/api/auth/login`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            email: credential.email,
            password: credential.password,
          }),
        })

        if (!response.ok) {
          throw new Error(await readResponseMessage(response))
        }

        const payload = (await response.json()) as { token: string; user: SessionUser }
        setToken(payload.token)
        setSession(payload.user)
        setOrderForm((current) => ({
          ...current,
          customerName: payload.user.role === 'customer' ? current.customerName || payload.user.name : current.customerName,
          phone: payload.user.role === 'customer' ? current.phone || payload.user.phone : current.phone,
        }))
        setServiceOnline(true)
        setMessage(`Signed in live as ${payload.user.name}.`)
      } else {
        setSession(fallbackUsers[credential.role])
        setToken(null)
        setOrderForm((current) => ({
          ...current,
          customerName:
            credential.role === 'customer'
              ? current.customerName || fallbackUsers[credential.role].name
              : current.customerName,
          phone:
            credential.role === 'customer'
              ? current.phone || fallbackUsers[credential.role].phone
              : current.phone,
        }))
        setMessage(`Signed in offline as ${fallbackUsers[credential.role].name}.`)
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to sign in.')
    } finally {
      setBusy(false)
      setActiveTab('ops')
    }
  }

  const submitOrder = async () => {
    if (!basket.length || !basketVendor) {
      setMessage('Add a meal to the basket first.')
      return
    }

    if (!orderForm.customerName || !orderForm.phone || !orderForm.address) {
      setMessage('Please complete your name, phone number, and delivery address.')
      return
    }

    setBusy(true)

    try {
      if (apiBaseUrl) {
        const response = await fetch(`${apiBaseUrl}/api/orders`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({
            customerName: orderForm.customerName,
            phone: orderForm.phone,
            address: orderForm.address,
            zoneId: orderForm.zoneId,
            notes: orderForm.notes,
            paymentMethod: orderForm.paymentMethod,
            ...(publicWebUrl
              ? {
                  successUrl: `${publicWebUrl}/?payment=success`,
                  cancelUrl: `${publicWebUrl}/?payment=cancel`,
                }
              : {}),
            items: basket.map((entry) => ({
              vendorId: entry.vendorId,
              menuItemId: entry.item.id,
              quantity: entry.quantity,
            })),
          }),
        })

        if (!response.ok) {
          throw new Error(await readResponseMessage(response))
        }

        const remoteOrder = (await response.json()) as OrderRecord
        setLastOrder(remoteOrder)
        setOrders((current) => [remoteOrder, ...current.filter((order) => order.orderId !== remoteOrder.orderId)])
        setMessage(remoteOrder.message ?? remoteOrder.statusLabel)

        if (remoteOrder.paymentUrl) {
          await Linking.openURL(remoteOrder.paymentUrl)
          setMessage('Secure checkout opened in your browser. Complete payment there to release the order.')
        }
      } else {
        const localOrder = createLocalOrder(orderForm, basketVendor, basket, session)
        setOrders((current) => [localOrder, ...current])
        setLastOrder(localOrder)
        setMessage(`${localOrder.orderId} captured in offline demo mode.`)
      }

      setBasket([])
      setOrderForm({
        ...emptyOrderForm,
        zoneId: orderForm.zoneId,
        customerName: session?.role === 'customer' ? session.name : '',
        phone: session?.role === 'customer' ? session.phone : '',
      })
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to submit the order.')
    } finally {
      setBusy(false)
    }
  }

  const advanceOrder = async (orderId: string, nextStatus: OrderStatus) => {
    if (!session) {
      return
    }

    setBusy(true)

    try {
      if (apiBaseUrl && token) {
        const response = await fetch(`${apiBaseUrl}/api/orders/${orderId}/status`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ status: nextStatus }),
        })

        if (!response.ok) {
          throw new Error(await readResponseMessage(response))
        }

        const updatedOrder = (await response.json()) as OrderRecord
        setOrders((current) => current.map((order) => (order.orderId === orderId ? updatedOrder : order)))
        setMessage(updatedOrder.message ?? `Order ${orderId} moved to ${statusLabels[nextStatus].toLowerCase()}.`)
      } else {
        setOrders((current) =>
          current.map((order) =>
            order.orderId === orderId
              ? {
                  ...order,
                  status: nextStatus,
                  statusLabel: statusLabels[nextStatus],
                  assignedRiderName:
                    session.role === 'rider' && nextStatus === 'on-route' ? session.name : order.assignedRiderName,
                  trackingSteps: buildTrackingSteps(nextStatus),
                  allowedNextStatuses: roleTransitions[session.role][nextStatus]
                    ? [roleTransitions[session.role][nextStatus] as OrderStatus]
                    : [],
                }
              : order,
          ),
        )
        setMessage(`Order ${orderId} moved to ${statusLabels[nextStatus].toLowerCase()}.`)
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to update the order.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style="light" />

      <View style={styles.shell}>
        <View style={styles.header}>
          <View>
            <Text style={styles.eyebrow}>Kwandebele local delivery</Text>
            <Text style={styles.title}>KasiEats Mobile</Text>
            <Text style={styles.subtitle}>
              Customer ordering, rider ops, and kitchen visibility in one mobile-first app.
            </Text>
          </View>
          <View style={[styles.statusPill, serviceOnline ? styles.livePill : styles.demoPill]}>
            <Text style={styles.statusText}>{serviceOnline ? 'Live API' : 'Offline demo'}</Text>
          </View>
        </View>

        <ScrollView
          style={styles.content}
          contentContainerStyle={styles.contentContainer}
          showsVerticalScrollIndicator={false}
        >
          {activeTab === 'discover' ? (
            <>
              <View style={styles.heroCard}>
                <Text style={styles.cardEyebrow}>Service message</Text>
                <Text style={styles.heroTitle}>Built for Kwamhlanga and Kwaggafontein streets.</Text>
                <Text style={styles.messageText}>{message}</Text>
              </View>

              <View style={styles.segmentRow}>
                {zones.map((zone) => (
                  <Pressable
                    key={zone.id}
                    style={[styles.zoneChip, activeZone === zone.id && styles.zoneChipActive]}
                    onPress={() => setActiveZone(zone.id)}
                  >
                    <Text style={styles.zoneName}>{zone.name}</Text>
                    <Text style={styles.zoneCoverage}>{zone.coverage}</Text>
                  </Pressable>
                ))}
              </View>

              <TextInput
                value={search}
                onChangeText={setSearch}
                placeholder="Search kota, pizza, stew..."
                placeholderTextColor="#9b7b66"
                style={styles.searchInput}
              />

              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.sortRow}>
                {vendorSortOptions.map((option) => (
                  <Pressable
                    key={option.id}
                    style={[styles.sortChip, vendorSort === option.id && styles.sortChipActive]}
                    onPress={() => setVendorSort(option.id)}
                  >
                    <Text style={[styles.sortChipText, vendorSort === option.id && styles.sortChipTextActive]}>
                      {option.label}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>

              <View style={styles.statRow}>
                {stats.map((stat) => (
                  <View key={stat.id} style={styles.statCard}>
                    <Text style={styles.cardEyebrow}>{stat.label}</Text>
                    <Text style={styles.statValue}>{stat.value}</Text>
                    <Text style={styles.statDetail}>{stat.detail}</Text>
                  </View>
                ))}
              </View>

              {selectedVendor ? (
                <ImageBackground
                  source={selectedVendor.coverImageUrl ? { uri: selectedVendor.coverImageUrl } : undefined}
                  imageStyle={styles.featuredImage}
                  style={[styles.featuredCard, { backgroundColor: selectedVendor.spotlight }]}
                >
                  <View style={styles.featuredOverlay}>
                    <Text style={styles.featuredEyebrow}>Featured restaurant</Text>
                    <Text style={styles.featuredTitle}>{selectedVendor.name}</Text>
                    <Text style={styles.featuredText}>{selectedVendor.deliveryNote ?? selectedVendor.description}</Text>
                    <View style={styles.pillRow}>
                      <Text style={styles.featuredPill}>{selectedVendor.signatureDish ?? 'House favourite'}</Text>
                      <Text style={styles.featuredPill}>{selectedVendor.rating.toFixed(1)} / 5</Text>
                      <Text style={styles.featuredPill}>{selectedVendor.eta}</Text>
                    </View>
                  </View>
                </ImageBackground>
              ) : null}

              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>Kitchens in your zone</Text>
                <Text style={styles.sectionCopy}>
                  {filteredVendors.length} restaurants sorted for {vendorSortOptions.find((option) => option.id === vendorSort)?.label.toLowerCase()}.
                </Text>
              </View>

              {filteredVendors.map((vendor) => (
                <Pressable
                  key={vendor.id}
                  style={[
                    styles.vendorCard,
                    selectedVendor?.id === vendor.id && styles.vendorCardSelected,
                  ]}
                  onPress={() => setSelectedVendorId(vendor.id)}
                >
                  <ImageBackground
                    source={vendor.coverImageUrl ? { uri: vendor.coverImageUrl } : undefined}
                    imageStyle={styles.vendorCardImage}
                    style={[styles.vendorImageWrap, { backgroundColor: vendor.spotlight }]}
                  >
                    <View style={styles.vendorImageOverlay}>
                      <Text style={styles.vendorHeroLabel}>{vendor.heroLabel}</Text>
                      <Text style={styles.vendorImageTitle}>{vendor.name}</Text>
                      <Text style={styles.vendorImageText}>{vendor.tagline}</Text>
                    </View>
                  </ImageBackground>

                  <View style={styles.vendorTop}>
                    <View style={[styles.vendorBadge, { backgroundColor: vendor.spotlight }]}>
                      <Text style={styles.vendorBadgeText}>{vendor.heroLabel}</Text>
                    </View>
                    <View style={styles.vendorCopy}>
                      <Text style={styles.cardEyebrow}>{vendor.area}</Text>
                      <Text style={styles.vendorName}>{vendor.name}</Text>
                      <Text style={styles.vendorText}>{vendor.signatureDish ?? vendor.tagline}</Text>
                    </View>
                  </View>
                  <Text style={styles.vendorText}>{vendor.description}</Text>
                  <View style={styles.pillRow}>
                    <Text style={styles.pill}>{vendor.eta}</Text>
                    <Text style={styles.pill}>{currency.format(vendor.deliveryFee)}</Text>
                    <Text style={styles.pill}>{vendor.rating.toFixed(1)} / 5</Text>
                  </View>
                  <View style={styles.pillRow}>
                    {vendor.categories.map((category) => (
                      <Text key={category} style={styles.categoryPill}>
                        {category}
                      </Text>
                    ))}
                  </View>
                </Pressable>
              ))}

              {selectedVendor ? (
                <View style={styles.menuPanel}>
                  <ImageBackground
                    source={selectedVendor.coverImageUrl ? { uri: selectedVendor.coverImageUrl } : undefined}
                    imageStyle={styles.menuHeroImage}
                    style={[styles.menuHero, { backgroundColor: selectedVendor.spotlight }]}
                  >
                    <View style={styles.menuHeroOverlay}>
                      <Text style={styles.menuHeroTitle}>{selectedVendor.name}</Text>
                      <Text style={styles.menuHeroText}>{selectedVendor.description}</Text>
                      <Text style={styles.menuHeroSubtext}>{selectedVendor.deliveryNote ?? selectedVendor.tagline}</Text>
                    </View>
                  </ImageBackground>

                  {selectedVendorGallery.length > 0 ? (
                    <ScrollView
                      horizontal
                      showsHorizontalScrollIndicator={false}
                      contentContainerStyle={styles.galleryRow}
                    >
                      {selectedVendorGallery.map((imageUrl) => (
                        <Image key={imageUrl} source={{ uri: imageUrl }} style={styles.galleryImage} />
                      ))}
                    </ScrollView>
                  ) : null}
                  {selectedVendor.menu.map((item) => (
                    <View key={item.id} style={styles.menuCard}>
                      <View style={styles.menuCardTop}>
                        {item.imageUrl ? <Image source={{ uri: item.imageUrl }} style={styles.menuItemImage} /> : null}
                        <View style={styles.menuCardCopy}>
                          <View style={styles.menuTitleRow}>
                            <Text style={styles.menuItemName}>{item.name}</Text>
                            {item.badge ? <Text style={styles.pill}>{item.badge}</Text> : null}
                          </View>
                          <Text style={styles.vendorText}>{item.description}</Text>
                          <View style={styles.pillRow}>
                            <Text style={styles.categoryPill}>{item.prepMinutes} min</Text>
                            <Text style={styles.categoryPill}>{selectedVendor.name}</Text>
                          </View>
                        </View>
                      </View>
                      <View style={styles.menuFooter}>
                        <View>
                          <Text style={styles.menuPrice}>{currency.format(item.price)}</Text>
                          <Text style={styles.vendorText}>Ready in about {item.prepMinutes} min</Text>
                        </View>
                        <Pressable style={styles.primaryButton} onPress={() => addToBasket(selectedVendor, item.id)}>
                          <Text style={styles.primaryButtonText}>Add</Text>
                        </Pressable>
                      </View>
                    </View>
                  ))}
                </View>
              ) : null}
            </>
          ) : null}

          {activeTab === 'basket' ? (
            <>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>Basket and checkout</Text>
                <Text style={styles.sectionCopy}>One vendor per basket keeps the route simple for riders.</Text>
              </View>

              {basket.length === 0 ? (
                <View style={styles.emptyCard}>
                  <Text style={styles.emptyTitle}>Basket is empty</Text>
                  <Text style={styles.vendorText}>Add meals from the discover tab to start an order.</Text>
                </View>
              ) : (
                basket.map((entry) => (
                  <View key={entry.item.id} style={styles.orderFeedCard}>
                    <Text style={styles.menuItemName}>{entry.item.name}</Text>
                    <Text style={styles.vendorText}>
                      {currency.format(entry.item.price)} each · qty {entry.quantity}
                    </Text>
                  </View>
                ))
              )}

              <View style={styles.billCard}>
                <Row label="Subtotal" value={currency.format(subtotal)} />
                <Row label="Delivery" value={currency.format(deliveryFee)} />
                <Row label="Total" value={currency.format(total)} strong />
              </View>

              <TextInput
                value={orderForm.customerName}
                onChangeText={(value) => setOrderForm((current) => ({ ...current, customerName: value }))}
                placeholder="Customer name"
                placeholderTextColor="#9b7b66"
                style={styles.searchInput}
              />
              <TextInput
                value={orderForm.phone}
                onChangeText={(value) => setOrderForm((current) => ({ ...current, phone: value }))}
                placeholder="Phone number"
                placeholderTextColor="#9b7b66"
                style={styles.searchInput}
              />
              <TextInput
                value={orderForm.address}
                onChangeText={(value) => setOrderForm((current) => ({ ...current, address: value }))}
                placeholder="Street, school gate, taxi rank, or landmark"
                placeholderTextColor="#9b7b66"
                style={[styles.searchInput, styles.multilineInput]}
                multiline
              />
              <TextInput
                value={orderForm.notes}
                onChangeText={(value) => setOrderForm((current) => ({ ...current, notes: value }))}
                placeholder="Driver notes"
                placeholderTextColor="#9b7b66"
                style={[styles.searchInput, styles.multilineInput]}
                multiline
              />

              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>Payment choice</Text>
                <Text style={styles.sectionCopy}>Card opens secure checkout, while cash and eWallet stay local.</Text>
              </View>

              <View style={styles.paymentRow}>
                {[
                  { id: 'cash', label: 'Cash' },
                  { id: 'card', label: 'Card' },
                  { id: 'ewallet', label: 'eWallet' },
                ].map((option) => (
                  <Pressable
                    key={option.id}
                    style={[
                      styles.paymentChip,
                      orderForm.paymentMethod === option.id && styles.paymentChipActive,
                    ]}
                    onPress={() =>
                      setOrderForm((current) => ({
                        ...current,
                        paymentMethod: option.id as OrderFormState['paymentMethod'],
                      }))
                    }
                  >
                    <Text
                      style={[
                        styles.paymentChipText,
                        orderForm.paymentMethod === option.id && styles.paymentChipTextActive,
                      ]}
                    >
                      {option.label}
                    </Text>
                  </Pressable>
                ))}
              </View>

              <Text style={styles.checkoutHint}>
                {orderForm.paymentMethod === 'card'
                  ? 'Stripe Checkout will open in the browser for secure card payment.'
                  : orderForm.paymentMethod === 'ewallet'
                    ? 'eWallet orders are recorded as already paid in the current platform flow.'
                    : 'Cash on delivery keeps the rider handoff simple for nearby drop-offs.'}
              </Text>

              <Pressable style={styles.primaryButtonWide} onPress={() => void submitOrder()}>
                <Text style={styles.primaryButtonText}>{busy ? 'Working...' : 'Request rider'}</Text>
              </Pressable>

              {lastOrder ? (
                <View style={styles.orderFeedCard}>
                  <Text style={styles.cardEyebrow}>Latest order</Text>
                  <Text style={styles.menuItemName}>{lastOrder.orderId}</Text>
                  <Text style={styles.vendorText}>
                    {lastOrder.vendorName} · {lastOrder.zoneName} · {lastOrder.eta}
                  </Text>
                  <View style={styles.pillRow}>
                    <Text style={styles.pill}>{lastOrder.paymentStatusLabel}</Text>
                  </View>
                  <TrackingRail steps={lastOrder.trackingSteps} />
                </View>
              ) : null}
            </>
          ) : null}

          {activeTab === 'ops' ? (
            <>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>Role dashboards</Text>
                <Text style={styles.sectionCopy}>Switch roles quickly and test the operational workflow.</Text>
              </View>

              {demoCredentials.map((credential) => (
                <Pressable key={credential.role} style={styles.roleCard} onPress={() => void loginWithCredential(credential)}>
                  <Text style={styles.cardEyebrow}>{credential.role}</Text>
                  <Text style={styles.menuItemName}>{credential.label}</Text>
                  <Text style={styles.vendorText}>{credential.summary}</Text>
                  <Text style={styles.credentialText}>{credential.email}</Text>
                </Pressable>
              ))}

              <View style={styles.heroCard}>
                <Text style={styles.cardEyebrow}>Current role</Text>
                <Text style={styles.heroTitle}>{session ? roleSummary.headline : 'No role selected yet'}</Text>
                {session ? (
                  <Text style={styles.messageText}>
                    {session.name} · {session.role}
                  </Text>
                ) : (
                  <Text style={styles.messageText}>Tap a demo account to unlock the relevant operations view.</Text>
                )}
              </View>

              {roleSummary.metrics.length > 0 ? (
                <View style={styles.statRow}>
                  {roleSummary.metrics.map((metric) => (
                    <View key={metric.label} style={styles.statCard}>
                      <Text style={styles.cardEyebrow}>{metric.label}</Text>
                      <Text style={styles.statValue}>{metric.value}</Text>
                    </View>
                  ))}
                </View>
              ) : null}

              {roleOrders.map((order) => {
                const nextStatus = roleTransitions[session?.role ?? 'customer'][order.status]

                return (
                  <View key={order.orderId} style={styles.orderFeedCard}>
                    <Text style={styles.cardEyebrow}>{order.statusLabel}</Text>
                    <Text style={styles.menuItemName}>{order.orderId}</Text>
                    <Text style={styles.vendorText}>
                      {order.vendorName} · {order.zoneName} · {currency.format(order.total)}
                    </Text>
                    <Text style={styles.vendorText}>{order.address}</Text>
                    <View style={styles.pillRow}>
                      <Text style={styles.pill}>{order.paymentStatusLabel}</Text>
                    </View>
                    <TrackingRail steps={order.trackingSteps} />
                    {nextStatus ? (
                      <Pressable
                        style={styles.secondaryButton}
                        onPress={() => void advanceOrder(order.orderId, nextStatus)}
                      >
                        <Text style={styles.secondaryButtonText}>{statusLabels[nextStatus]}</Text>
                      </Pressable>
                    ) : null}
                  </View>
                )
              })}
            </>
          ) : null}

          {activeTab === 'profile' ? (
            <>
              <View style={styles.heroCard}>
                <Text style={styles.cardEyebrow}>App profile</Text>
                <Text style={styles.heroTitle}>{session ? session.name : 'Guest mode'}</Text>
                <Text style={styles.messageText}>
                  {session
                    ? `${session.role} access is active.`
                    : 'Use guest discovery or switch to a seeded operational role.'}
                </Text>
              </View>

              <View style={styles.infoCard}>
                <Text style={styles.menuItemName}>Mobile strengths</Text>
                <Text style={styles.vendorText}>Offline-first marketplace fallback</Text>
                <Text style={styles.vendorText}>Role-based ops tab for vendor, rider, and admin flows</Text>
                <Text style={styles.vendorText}>Ready to point at Render with EXPO_PUBLIC_API_BASE_URL</Text>
              </View>

              <View style={styles.infoCard}>
                <Text style={styles.menuItemName}>API target</Text>
                <Text style={styles.credentialText}>{apiBaseUrl || 'Not configured yet'}</Text>
                <Text style={styles.vendorText}>
                  Set `EXPO_PUBLIC_API_BASE_URL` to your Render web service URL to use live auth and orders.
                </Text>
              </View>
            </>
          ) : null}
        </ScrollView>

        <View style={styles.tabBar}>
          <TabButton label="Discover" active={activeTab === 'discover'} onPress={() => setActiveTab('discover')} />
          <TabButton label="Basket" active={activeTab === 'basket'} onPress={() => setActiveTab('basket')} />
          <TabButton label="Ops" active={activeTab === 'ops'} onPress={() => setActiveTab('ops')} />
          <TabButton label="Profile" active={activeTab === 'profile'} onPress={() => setActiveTab('profile')} />
        </View>
      </View>
    </SafeAreaView>
  )
}

function TabButton({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable style={[styles.tabButton, active && styles.tabButtonActive]} onPress={onPress}>
      <Text style={[styles.tabText, active && styles.tabTextActive]}>{label}</Text>
    </Pressable>
  )
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <View style={styles.row}>
      <Text style={[styles.rowLabel, strong && styles.rowStrong]}>{label}</Text>
      <Text style={[styles.rowValue, strong && styles.rowStrong]}>{value}</Text>
    </View>
  )
}

function TrackingRail({ steps }: { steps: TrackingStep[] }) {
  return (
    <View style={styles.trackingRail}>
      {steps.map((step) => (
        <View key={step.id} style={styles.trackingStep}>
          <View
            style={[
              styles.trackingDot,
              step.state === 'done' && styles.trackingDone,
              step.state === 'current' && styles.trackingCurrent,
            ]}
          />
          <Text style={styles.trackingText}>{step.label}</Text>
        </View>
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: '#1b120b',
  },
  shell: {
    flex: 1,
    backgroundColor: '#f4efe7',
  },
  header: {
    paddingHorizontal: 18,
    paddingTop: 10,
    paddingBottom: 18,
    backgroundColor: '#1b120b',
    gap: 14,
  },
  eyebrow: {
    color: '#f7c7a1',
    fontSize: 11,
    letterSpacing: 2,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  title: {
    color: '#fff7ed',
    fontSize: 30,
    fontWeight: '800',
    marginBottom: 8,
  },
  subtitle: {
    color: '#d9b39c',
    fontSize: 14,
    lineHeight: 20,
  },
  statusPill: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  livePill: {
    backgroundColor: 'rgba(16, 185, 129, 0.16)',
  },
  demoPill: {
    backgroundColor: 'rgba(249, 115, 22, 0.16)',
  },
  statusText: {
    color: '#fff7ed',
    fontWeight: '700',
  },
  content: {
    flex: 1,
  },
  contentContainer: {
    padding: 18,
    paddingBottom: 120,
    gap: 16,
  },
  heroCard: {
    backgroundColor: '#fffaf4',
    borderRadius: 28,
    padding: 18,
    shadowColor: '#7c2d12',
    shadowOpacity: 0.08,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 5,
  },
  cardEyebrow: {
    color: '#b45309',
    fontSize: 11,
    letterSpacing: 1.8,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  heroTitle: {
    color: '#2b170b',
    fontSize: 24,
    fontWeight: '800',
    lineHeight: 30,
    marginBottom: 10,
  },
  messageText: {
    color: '#7d5b45',
    fontSize: 14,
    lineHeight: 21,
  },
  segmentRow: {
    flexDirection: 'row',
    gap: 12,
  },
  zoneChip: {
    flex: 1,
    backgroundColor: '#fff7ed',
    borderRadius: 22,
    padding: 14,
    borderWidth: 1,
    borderColor: 'rgba(125, 76, 46, 0.12)',
  },
  zoneChipActive: {
    backgroundColor: '#fed7aa',
    borderColor: '#f97316',
  },
  zoneName: {
    color: '#2b170b',
    fontWeight: '800',
    marginBottom: 4,
  },
  zoneCoverage: {
    color: '#7d5b45',
    fontSize: 12,
  },
  searchInput: {
    backgroundColor: '#fffaf4',
    borderRadius: 18,
    paddingHorizontal: 16,
    paddingVertical: 14,
    color: '#2b170b',
    borderWidth: 1,
    borderColor: 'rgba(125, 76, 46, 0.14)',
  },
  multilineInput: {
    minHeight: 90,
    textAlignVertical: 'top',
  },
  sortRow: {
    gap: 10,
    paddingRight: 6,
  },
  sortChip: {
    backgroundColor: '#fff7ed',
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 11,
    borderWidth: 1,
    borderColor: 'rgba(125, 76, 46, 0.12)',
  },
  sortChipActive: {
    backgroundColor: '#2b170b',
    borderColor: '#2b170b',
  },
  sortChipText: {
    color: '#7d5b45',
    fontWeight: '700',
  },
  sortChipTextActive: {
    color: '#fff7ed',
  },
  statRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  statCard: {
    flexGrow: 1,
    minWidth: 104,
    backgroundColor: '#fffaf4',
    borderRadius: 22,
    padding: 16,
  },
  statValue: {
    color: '#2b170b',
    fontSize: 24,
    fontWeight: '800',
    marginBottom: 6,
  },
  statDetail: {
    color: '#7d5b45',
    fontSize: 12,
    lineHeight: 18,
  },
  sectionHeader: {
    gap: 4,
  },
  sectionTitle: {
    color: '#2b170b',
    fontSize: 20,
    fontWeight: '800',
  },
  sectionCopy: {
    color: '#7d5b45',
    fontSize: 13,
  },
  featuredCard: {
    minHeight: 220,
    borderRadius: 28,
    overflow: 'hidden',
    justifyContent: 'flex-end',
  },
  featuredImage: {
    borderRadius: 28,
  },
  featuredOverlay: {
    padding: 18,
    backgroundColor: 'rgba(20, 12, 7, 0.42)',
    gap: 10,
  },
  featuredEyebrow: {
    color: '#ffedd5',
    fontSize: 11,
    letterSpacing: 2,
    textTransform: 'uppercase',
    fontWeight: '700',
  },
  featuredTitle: {
    color: '#fff7ed',
    fontSize: 27,
    fontWeight: '800',
  },
  featuredText: {
    color: '#ffedd5',
    fontSize: 13,
    lineHeight: 20,
  },
  featuredPill: {
    backgroundColor: 'rgba(255, 247, 237, 0.18)',
    color: '#fff7ed',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    fontSize: 12,
    overflow: 'hidden',
  },
  vendorCard: {
    backgroundColor: '#fffaf4',
    borderRadius: 24,
    padding: 16,
    gap: 12,
  },
  vendorCardSelected: {
    borderWidth: 1,
    borderColor: '#f97316',
  },
  vendorImageWrap: {
    minHeight: 148,
    borderRadius: 22,
    overflow: 'hidden',
    justifyContent: 'flex-end',
  },
  vendorCardImage: {
    borderRadius: 22,
  },
  vendorImageOverlay: {
    backgroundColor: 'rgba(20, 12, 7, 0.32)',
    padding: 14,
    gap: 4,
  },
  vendorHeroLabel: {
    color: '#fff7ed',
    fontSize: 10,
    letterSpacing: 2,
    fontWeight: '700',
  },
  vendorImageTitle: {
    color: '#fff7ed',
    fontSize: 21,
    fontWeight: '800',
  },
  vendorImageText: {
    color: '#ffedd5',
    fontSize: 12,
    lineHeight: 18,
  },
  vendorTop: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'flex-start',
  },
  vendorBadge: {
    width: 52,
    height: 52,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  vendorBadgeText: {
    color: '#fff7ed',
    fontWeight: '800',
    letterSpacing: 1.8,
  },
  vendorCopy: {
    flex: 1,
  },
  vendorName: {
    color: '#2b170b',
    fontSize: 18,
    fontWeight: '800',
    marginBottom: 6,
  },
  vendorText: {
    color: '#7d5b45',
    fontSize: 13,
    lineHeight: 20,
  },
  pillRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  pill: {
    backgroundColor: 'rgba(249, 115, 22, 0.12)',
    color: '#9a3412',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    fontSize: 12,
    overflow: 'hidden',
  },
  categoryPill: {
    backgroundColor: '#fff4e5',
    color: '#9a3412',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    fontSize: 12,
    overflow: 'hidden',
  },
  paymentRow: {
    flexDirection: 'row',
    gap: 10,
  },
  paymentChip: {
    flex: 1,
    alignItems: 'center',
    backgroundColor: '#fffaf4',
    borderRadius: 18,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: 'rgba(125, 76, 46, 0.14)',
  },
  paymentChipActive: {
    backgroundColor: '#fed7aa',
    borderColor: '#ea580c',
  },
  paymentChipText: {
    color: '#7d5b45',
    fontWeight: '700',
  },
  paymentChipTextActive: {
    color: '#9a3412',
  },
  checkoutHint: {
    color: '#7d5b45',
    fontSize: 12,
    lineHeight: 18,
  },
  menuPanel: {
    gap: 12,
  },
  menuHero: {
    borderRadius: 24,
    minHeight: 200,
    overflow: 'hidden',
    justifyContent: 'flex-end',
  },
  menuHeroImage: {
    borderRadius: 24,
  },
  menuHeroOverlay: {
    padding: 18,
    backgroundColor: 'rgba(32, 18, 8, 0.38)',
  },
  menuHeroTitle: {
    color: '#fff7ed',
    fontSize: 22,
    fontWeight: '800',
    marginBottom: 8,
  },
  menuHeroText: {
    color: '#ffedd5',
    fontSize: 13,
    lineHeight: 19,
    marginBottom: 8,
  },
  menuHeroSubtext: {
    color: '#fff7ed',
    fontSize: 12,
    lineHeight: 18,
    opacity: 0.92,
  },
  galleryRow: {
    gap: 10,
    paddingRight: 6,
  },
  galleryImage: {
    width: 138,
    height: 96,
    borderRadius: 18,
  },
  menuCard: {
    backgroundColor: '#fffaf4',
    borderRadius: 22,
    padding: 16,
    gap: 10,
  },
  menuCardTop: {
    flexDirection: 'row',
    gap: 14,
  },
  menuCardCopy: {
    flex: 1,
    gap: 8,
  },
  menuItemImage: {
    width: 96,
    height: 96,
    borderRadius: 20,
    backgroundColor: '#f5d6bc',
  },
  menuTitleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
    alignItems: 'center',
  },
  menuItemName: {
    color: '#2b170b',
    fontSize: 18,
    fontWeight: '800',
  },
  menuFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
  },
  menuPrice: {
    color: '#2b170b',
    fontSize: 16,
    fontWeight: '800',
  },
  primaryButton: {
    backgroundColor: '#ea580c',
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 11,
  },
  primaryButtonWide: {
    backgroundColor: '#ea580c',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 15,
    alignItems: 'center',
  },
  primaryButtonText: {
    color: '#fff7ed',
    fontWeight: '800',
  },
  emptyCard: {
    backgroundColor: '#fffaf4',
    borderRadius: 22,
    padding: 18,
    gap: 8,
  },
  emptyTitle: {
    color: '#2b170b',
    fontSize: 18,
    fontWeight: '800',
  },
  orderFeedCard: {
    backgroundColor: '#fffaf4',
    borderRadius: 22,
    padding: 16,
    gap: 10,
  },
  billCard: {
    backgroundColor: '#fff4e5',
    borderRadius: 22,
    padding: 16,
    gap: 10,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
  },
  rowLabel: {
    color: '#7d5b45',
  },
  rowValue: {
    color: '#2b170b',
  },
  rowStrong: {
    fontWeight: '800',
    color: '#2b170b',
  },
  roleCard: {
    backgroundColor: '#fffaf4',
    borderRadius: 22,
    padding: 16,
    gap: 8,
  },
  credentialText: {
    color: '#2b170b',
    fontSize: 12,
    fontWeight: '700',
  },
  secondaryButton: {
    backgroundColor: '#fff4e5',
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 11,
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: 'rgba(125, 76, 46, 0.14)',
  },
  secondaryButtonText: {
    color: '#2b170b',
    fontWeight: '700',
  },
  infoCard: {
    backgroundColor: '#fffaf4',
    borderRadius: 22,
    padding: 16,
    gap: 8,
  },
  tabBar: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 18,
    backgroundColor: '#fff7ed',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
  },
  tabButton: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 12,
    borderRadius: 16,
  },
  tabButtonActive: {
    backgroundColor: '#2b170b',
  },
  tabText: {
    color: '#7d5b45',
    fontWeight: '700',
  },
  tabTextActive: {
    color: '#fff7ed',
  },
  trackingRail: {
    gap: 8,
  },
  trackingStep: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  trackingDot: {
    width: 10,
    height: 10,
    borderRadius: 999,
    backgroundColor: '#dec7b4',
  },
  trackingDone: {
    backgroundColor: '#0f766e',
  },
  trackingCurrent: {
    backgroundColor: '#ea580c',
  },
  trackingText: {
    color: '#7d5b45',
    fontSize: 12,
  },
})
