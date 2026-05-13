import {
  startTransition,
  type ChangeEvent,
  type FormEvent,
  useDeferredValue,
  useEffect,
  useEffectEvent,
  useMemo,
  useState,
} from 'react'
import './App.css'
import { demoCredentials, roleHighlights, seedStats, seedVendors, zones } from './data'
import type {
  AdminOverview,
  AuthSession,
  BasketEntry,
  CustomerDashboard,
  DemoCredential,
  DispatchRecord,
  OrderFormState,
  OrderRecord,
  OrderStatus,
  PickupRequestFormState,
  PickupRequestRecord,
  PickupRequestStatus,
  PickupRequestSubmission,
  OrderSubmission,
  RiderDashboard,
  RoleHighlight,
  ServiceStat,
  SessionUser,
  TrackingStep,
  UserRole,
  Vendor,
  VendorDashboard,
  ZoneId,
} from './types'

const appName = 'KasiRunner'

const currency = new Intl.NumberFormat('en-ZA', {
  style: 'currency',
  currency: 'ZAR',
  maximumFractionDigits: 0,
})

const storageKey = 'kasirunner.session'
const defaultZone = zones[0]?.id ?? 'kwamhlanga'
const dashboardRoutes: Record<UserRole, string> = {
  customer: '/api/customer/dashboard',
  vendor: '/api/vendor/dashboard',
  rider: '/api/rider/dashboard',
  admin: '/api/admin/overview',
}
const vendorSortOptions = [
  { id: 'trending', label: 'Trending' },
  { id: 'rating', label: 'Top rated' },
  { id: 'fastest', label: 'Fastest' },
  { id: 'delivery', label: 'Lowest fee' },
] as const
const operationalRoleOptions = [
  { id: 'vendor', label: 'Vendor' },
  { id: 'rider', label: 'Rider' },
  { id: 'admin', label: 'Admin' },
] as const
type OperationalRole = (typeof operationalRoleOptions)[number]['id']

const emptyForm: OrderFormState = {
  customerName: '',
  phone: '',
  address: '',
  zoneId: defaultZone,
  notes: '',
  paymentMethod: 'cash',
}
const emptyPickupForm: PickupRequestFormState = {
  customerName: '',
  phone: '',
  zoneId: defaultZone,
  pickupAddress: '',
  dropoffAddress: '',
  itemDescription: '',
  notes: '',
  paymentMethod: 'cash',
}
const emptyRegistrationForm = {
  name: '',
  email: '',
  phone: '',
  password: '',
  zoneId: defaultZone,
}
const emptyOperationalAccountForm = {
  name: '',
  email: '',
  phone: '',
  password: '',
  role: 'vendor' as OperationalRole,
  vendorId: seedVendors[0]?.id ?? '',
  zoneIds: [defaultZone] as ZoneId[],
}

async function readResponseMessage(response: Response) {
  try {
    const payload = (await response.json()) as { message?: string }
    return payload.message ?? `Request failed with status ${response.status}.`
  } catch {
    return `Request failed with status ${response.status}.`
  }
}

function safeStorageGetItem(key: string) {
  try {
    return window.localStorage.getItem(key)
  } catch (error) {
    console.warn('Unable to read local storage.', error)
    return null
  }
}

function safeStorageSetItem(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value)
  } catch (error) {
    console.warn('Unable to write local storage.', error)
  }
}

function safeStorageRemoveItem(key: string) {
  try {
    window.localStorage.removeItem(key)
  } catch (error) {
    console.warn('Unable to remove local storage item.', error)
  }
}

function readCheckoutFeedbackFromLocation() {
  const params = new URLSearchParams(window.location.search)
  const payment = params.get('payment')

  if (payment === 'success') {
    return 'Card payment confirmed. The kitchen can now start processing your order.'
  }

  if (payment === 'cancel') {
    return 'Card checkout was cancelled. You can try again from the basket whenever you are ready.'
  }

  return 'Order food, request a pickup run, and track the local driver flow from one place.'
}

function estimateEtaMinutes(eta: string) {
  const match = eta.match(/\d+/)
  return match ? Number(match[0]) : 999
}

function estimatePickupServiceFee(zoneId: ZoneId) {
  return zoneId === 'kwaggafontein' ? 45 : 35
}

function getDispatchTimestamp(task: DispatchRecord) {
  return task.taskType === 'pickup' ? task.requestedAt : task.placedAt
}

function getTaskActionLabel(task: DispatchRecord, status: OrderStatus | PickupRequestStatus) {
  if (task.taskType === 'pickup') {
    if (status === 'accepted') return 'Accept pickup'
    if (status === 'collecting') return 'Mark collected'
    if (status === 'on-route') return 'Start drop-off'
    return 'Close pickup'
  }

  if (status === 'accepted') return 'Accept order'
  if (status === 'preparing') return 'Start prep'
  if (status === 'ready') return 'Mark ready'
  if (status === 'on-route') return 'Hand to rider'
  return 'Close order'
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

function App() {
  const [vendors, setVendors] = useState<Vendor[]>(seedVendors)
  const [stats, setStats] = useState<ServiceStat[]>(seedStats)
  const [activeZone, setActiveZone] = useState<ZoneId>(defaultZone)
  const [selectedVendorId, setSelectedVendorId] = useState(seedVendors[0]?.id ?? '')
  const [search, setSearch] = useState('')
  const [vendorSort, setVendorSort] = useState<(typeof vendorSortOptions)[number]['id']>('trending')
  const [basket, setBasket] = useState<BasketEntry[]>([])
  const [orderForm, setOrderForm] = useState<OrderFormState>(emptyForm)
  const [pickupForm, setPickupForm] = useState<PickupRequestFormState>(emptyPickupForm)
  const [serviceOnline, setServiceOnline] = useState(false)
  const [feedback, setFeedback] = useState(readCheckoutFeedbackFromLocation)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [lastOrder, setLastOrder] = useState<OrderRecord | null>(null)
  const [lastPickupRequest, setLastPickupRequest] = useState<PickupRequestRecord | null>(null)
  const [session, setSession] = useState<AuthSession | null>(null)
  const [authForm, setAuthForm] = useState({
    email: demoCredentials[0]?.email ?? '',
    password: demoCredentials[0]?.password ?? '',
  })
  const [registerForm, setRegisterForm] = useState(emptyRegistrationForm)
  const [authBusy, setAuthBusy] = useState(false)
  const [registerBusy, setRegisterBusy] = useState(false)
  const [authMessage, setAuthMessage] = useState(
    'Sign in with a demo role or create a real customer account. Operational roles stay admin-controlled.',
  )
  const [adminCreateForm, setAdminCreateForm] = useState(emptyOperationalAccountForm)
  const [adminCreateBusy, setAdminCreateBusy] = useState(false)
  const [latestProvisionedUser, setLatestProvisionedUser] = useState<SessionUser | null>(null)
  const [opsBusy, setOpsBusy] = useState(false)
  const [customerDashboard, setCustomerDashboard] = useState<CustomerDashboard | null>(null)
  const [vendorDashboard, setVendorDashboard] = useState<VendorDashboard | null>(null)
  const [riderDashboard, setRiderDashboard] = useState<RiderDashboard | null>(null)
  const [adminOverview, setAdminOverview] = useState<AdminOverview | null>(null)
  const deferredSearch = useDeferredValue(search)

  const clearDashboards = () => {
    setCustomerDashboard(null)
    setVendorDashboard(null)
    setRiderDashboard(null)
    setAdminOverview(null)
  }

  const persistSession = (nextSession: AuthSession) => {
    setSession(nextSession)
    safeStorageSetItem(storageKey, JSON.stringify(nextSession))
  }

  const clearSession = (message?: string) => {
    setSession(null)
    clearDashboards()
    safeStorageRemoveItem(storageKey)

    if (message) {
      setAuthMessage(message)
    }
  }

  const applyCustomerProfile = (user: SessionUser) => {
    if (user.role !== 'customer') {
      return
    }

    const savedZone = user.zoneIds?.[0] ?? defaultZone

    startTransition(() => {
      setActiveZone(savedZone)
      setOrderForm((current) => ({
        ...current,
        zoneId: savedZone,
        customerName: current.customerName || user.name,
        phone: current.phone || user.phone,
      }))
      setPickupForm((current) => ({
        ...current,
        zoneId: savedZone,
        customerName: current.customerName || user.name,
        phone: current.phone || user.phone,
      }))
    })
  }

  const activateSession = async (nextSession: AuthSession, message: string, feedbackMessage?: string) => {
    persistSession(nextSession)
    applyCustomerProfile(nextSession.user)
    setAuthMessage(message)

    if (feedbackMessage) {
      setFeedback(feedbackMessage)
    }

    await loadDashboard(nextSession)
  }

  const loadDashboard = async (nextSession: AuthSession) => {
    setOpsBusy(true)

    try {
      const response = await fetch(dashboardRoutes[nextSession.user.role], {
        headers: {
          Authorization: `Bearer ${nextSession.token}`,
        },
      })

      if (!response.ok) {
        throw new Error(await readResponseMessage(response))
      }

      clearDashboards()

      if (nextSession.user.role === 'customer') {
        setCustomerDashboard((await response.json()) as CustomerDashboard)
      } else if (nextSession.user.role === 'vendor') {
        setVendorDashboard((await response.json()) as VendorDashboard)
      } else if (nextSession.user.role === 'rider') {
        setRiderDashboard((await response.json()) as RiderDashboard)
      } else {
        setAdminOverview((await response.json()) as AdminOverview)
      }
    } catch (error) {
      clearSession(error instanceof Error ? error.message : 'Session expired. Please log in again.')
    } finally {
      setOpsBusy(false)
    }
  }

  const restoreSavedSession = useEffectEvent(async (parsed: AuthSession) => {
    setAuthBusy(true)

    try {
      const response = await fetch('/api/auth/me', {
        headers: {
          Authorization: `Bearer ${parsed.token}`,
        },
      })

      if (!response.ok) {
        throw new Error(await readResponseMessage(response))
      }

      const payload = (await response.json()) as { user: SessionUser }
      const nextSession = {
        token: parsed.token,
        user: payload.user,
      }

      await activateSession(nextSession, `Welcome back, ${payload.user.name}.`)
    } catch (error) {
      clearSession(error instanceof Error ? error.message : 'Saved session expired.')
    } finally {
      setAuthBusy(false)
    }
  })

  useEffect(() => {
    let ignore = false

    async function loadMarketplace() {
      try {
        const response = await fetch('/api/marketplace')

        if (!response.ok) {
          throw new Error('Marketplace service unavailable')
        }

        const payload = (await response.json()) as {
          vendors: Vendor[]
          stats: ServiceStat[]
        }

        if (!ignore) {
          setVendors(mergeVendorVisuals(payload.vendors))
          setStats(payload.stats)
          setServiceOnline(true)
          setFeedback('Dispatch service is online and role dashboards are available.')
        }
      } catch {
        if (!ignore) {
          setServiceOnline(false)
          setFeedback('Marketplace is running in seeded fallback mode while the API boots.')
        }
      }
    }

    void loadMarketplace()

    return () => {
      ignore = true
    }
  }, [])

  useEffect(() => {
    const saved = safeStorageGetItem(storageKey)

    if (!saved) {
      return
    }

    try {
      const parsed = JSON.parse(saved) as AuthSession
      queueMicrotask(() => {
        void restoreSavedSession(parsed)
      })
    } catch {
      safeStorageRemoveItem(storageKey)
    }
  }, [])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const payment = params.get('payment')

    if (!payment) {
      return
    }

    window.history.replaceState({}, document.title, window.location.pathname)
  }, [])

  const trimmedSearch = deferredSearch.trim().toLowerCase()
  const visibleVendors = useMemo(() => {
    const filtered = vendors.filter((vendor) => {
      const matchesZone = vendor.zoneIds.includes(activeZone)

      if (!trimmedSearch) {
        return matchesZone
      }

      const searchableText = [
        vendor.name,
        vendor.tagline,
        vendor.area,
        vendor.description,
        vendor.categories.join(' '),
        vendor.signatureDish ?? '',
        vendor.menu.map((item) => `${item.name} ${item.description}`).join(' '),
      ]
        .join(' ')
        .toLowerCase()

      return matchesZone && searchableText.includes(trimmedSearch)
    })

    return [...filtered].sort((left, right) => {
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
  }, [activeZone, trimmedSearch, vendorSort, vendors])

  const selectedVendor =
    visibleVendors.find((vendor) => vendor.id === selectedVendorId) ??
    visibleVendors[0] ??
    vendors.find((vendor) => vendor.id === selectedVendorId) ??
    vendors[0]

  const basketVendor =
    (basket[0] &&
      vendors.find((vendor) => vendor.id === basket[0].vendorId)) ||
    selectedVendor

  const basketCount = basket.reduce((total, entry) => total + entry.quantity, 0)
  const subtotal = basket.reduce((total, entry) => total + entry.item.price * entry.quantity, 0)
  const deliveryFee = basketCount > 0 && basketVendor ? basketVendor.deliveryFee : 0
  const total = subtotal + deliveryFee
  const activeZoneDetails = zones.find((zone) => zone.id === activeZone) ?? zones[0]
  const activeRole = session?.user.role ?? null
  const activeRoleHighlight =
    (activeRole && roleHighlights.find((role) => role.role === activeRole)) || null
  const featuredVendor = selectedVendor ?? visibleVendors[0] ?? vendors[0]
  const selectedVendorGallery =
    selectedVendor?.galleryImageUrls?.length
      ? selectedVendor.galleryImageUrls
      : selectedVendor?.coverImageUrl
        ? [selectedVendor.coverImageUrl]
        : []
  const customerDispatchFeed = useMemo(
    () =>
      customerDashboard
        ? [...customerDashboard.orders, ...customerDashboard.pickupRequests].sort(
            (left, right) =>
              new Date(getDispatchTimestamp(right)).getTime() -
              new Date(getDispatchTimestamp(left)).getTime(),
          )
        : [],
    [customerDashboard],
  )
  const dispatchFeed =
    customerDashboard
      ? customerDispatchFeed
      : vendorDashboard?.liveOrders ??
        riderDashboard?.tasks ??
        adminOverview?.liveTasks ??
        []

  const setZone = (zoneId: ZoneId) => {
    startTransition(() => {
      setActiveZone(zoneId)
      setOrderForm((current) => ({ ...current, zoneId }))
      setPickupForm((current) => ({ ...current, zoneId }))
    })
  }

  const addToBasket = (vendor: Vendor, itemId: string) => {
    const item = vendor.menu.find((menuItem) => menuItem.id === itemId)

    if (!item) {
      return
    }

    const switchingVendor = basket.length > 0 && basket[0].vendorId !== vendor.id

    setBasket((current) => {
      if (switchingVendor) {
        return [{ vendorId: vendor.id, item, quantity: 1 }]
      }

      const existingEntry = current.find(
        (entry) => entry.vendorId === vendor.id && entry.item.id === item.id,
      )

      if (!existingEntry) {
        return [...current, { vendorId: vendor.id, item, quantity: 1 }]
      }

      return current.map((entry) =>
        entry.vendorId === vendor.id && entry.item.id === item.id
          ? { ...entry, quantity: entry.quantity + 1 }
          : entry,
      )
    })

    setSelectedVendorId(vendor.id)
    setFeedback(
      switchingVendor
        ? `Basket switched to ${vendor.name} so one rider can handle the whole trip.`
        : `${item.name} is in the basket and ready for checkout.`,
    )
  }

  const changeBasketQuantity = (itemId: string, nextQuantity: number) => {
    setBasket((current) =>
      current.flatMap((entry) => {
        if (entry.item.id !== itemId) {
          return [entry]
        }

        if (nextQuantity <= 0) {
          return []
        }

        return [{ ...entry, quantity: nextQuantity }]
      }),
    )
  }

  const clearBasket = () => {
    setBasket([])
    setFeedback('Basket cleared. You can start a fresh order whenever you are ready.')
  }

  const updateOrderForm = (
    event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>,
  ) => {
    const field = event.target.name as keyof OrderFormState
    const value = event.target.value

    setOrderForm((current) => ({
      ...current,
      [field]: value as OrderFormState[typeof field],
    }))
  }

  const updatePickupForm = (
    event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>,
  ) => {
    const field = event.target.name as keyof PickupRequestFormState
    const value = event.target.value

    setPickupForm((current) => ({
      ...current,
      [field]: value as PickupRequestFormState[typeof field],
    }))
  }

  const updateAuthForm = (event: ChangeEvent<HTMLInputElement>) => {
    const { name, value } = event.target
    setAuthForm((current) => ({ ...current, [name]: value }))
  }

  const updateRegisterForm = (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const field = event.target.name as keyof typeof emptyRegistrationForm
    const value = event.target.value

    setRegisterForm((current) => ({
      ...current,
      [field]: value as (typeof emptyRegistrationForm)[typeof field],
    }))
  }

  const updateAdminCreateForm = (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = event.target

    if (name === 'role') {
      const nextRole = value as OperationalRole
      setAdminCreateForm((current) => ({
        ...current,
        role: nextRole,
        vendorId: nextRole === 'vendor' ? current.vendorId || vendors[0]?.id || '' : '',
        zoneIds: nextRole === 'vendor' ? [] : current.zoneIds.length ? current.zoneIds : [defaultZone],
      }))
      return
    }

    const field = name as 'name' | 'email' | 'phone' | 'password' | 'vendorId'
    setAdminCreateForm((current) => ({
      ...current,
      [field]: value,
    }))
  }

  const toggleAdminZone = (zoneId: ZoneId) => {
    setAdminCreateForm((current) => ({
      ...current,
      zoneIds: current.zoneIds.includes(zoneId)
        ? current.zoneIds.filter((currentZoneId) => currentZoneId !== zoneId)
        : [...current.zoneIds, zoneId],
    }))
  }

  const signIn = async (email: string, password: string) => {
    setAuthBusy(true)

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email,
          password,
        }),
      })

      if (!response.ok) {
        throw new Error(await readResponseMessage(response))
      }

      const nextSession = (await response.json()) as AuthSession
      await activateSession(
        nextSession,
        `Signed in as ${nextSession.user.name} (${nextSession.user.role}).`,
        `Role gates are active for ${nextSession.user.role}.`,
      )
    } catch (error) {
      setAuthMessage(error instanceof Error ? error.message : 'Unable to sign in right now.')
    } finally {
      setAuthBusy(false)
    }
  }

  const submitLogin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    await signIn(authForm.email, authForm.password)
  }

  const signInWithDemo = async (credential: DemoCredential) => {
    setAuthForm({
      email: credential.email,
      password: credential.password,
    })
    await signIn(credential.email, credential.password)
  }

  const submitCustomerRegistration = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setRegisterBusy(true)

    try {
      const response = await fetch('/api/auth/register', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(registerForm),
      })

      if (!response.ok) {
        throw new Error(await readResponseMessage(response))
      }

      const nextSession = (await response.json()) as AuthSession
      setAuthForm({
        email: registerForm.email,
        password: registerForm.password,
      })
      setRegisterForm(emptyRegistrationForm)
      await activateSession(
        nextSession,
        `Welcome to ${appName}, ${nextSession.user.name}. Your customer account is ready.`,
        'Customer account created and signed in. You can place your first order or pickup request now.',
      )
    } catch (error) {
      setAuthMessage(error instanceof Error ? error.message : 'Unable to create your customer account right now.')
    } finally {
      setRegisterBusy(false)
    }
  }

  const submitOperationalUserCreation = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (!session || session.user.role !== 'admin') {
      return
    }

    if (adminCreateForm.role === 'vendor' && !adminCreateForm.vendorId) {
      setFeedback('Select the kitchen this vendor account should manage.')
      return
    }

    if (adminCreateForm.role === 'rider' && adminCreateForm.zoneIds.length === 0) {
      setFeedback('Choose at least one service zone for a rider account.')
      return
    }

    setAdminCreateBusy(true)

    try {
      const response = await fetch('/api/admin/users', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.token}`,
        },
        body: JSON.stringify({
          name: adminCreateForm.name,
          email: adminCreateForm.email,
          phone: adminCreateForm.phone,
          password: adminCreateForm.password,
          role: adminCreateForm.role,
          ...(adminCreateForm.role === 'vendor'
            ? { vendorId: adminCreateForm.vendorId }
            : { zoneIds: adminCreateForm.zoneIds }),
        }),
      })

      if (!response.ok) {
        throw new Error(await readResponseMessage(response))
      }

      const payload = (await response.json()) as { user: SessionUser }
      setLatestProvisionedUser(payload.user)
      setAdminCreateForm({
        ...emptyOperationalAccountForm,
        vendorId: vendors[0]?.id ?? emptyOperationalAccountForm.vendorId,
      })
      setAuthMessage(`${payload.user.role} account created for ${payload.user.name}.`)
      setFeedback(`${payload.user.name} can now sign in as ${payload.user.role}.`)
      await loadDashboard(session)
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : 'Unable to create the operational account right now.')
    } finally {
      setAdminCreateBusy(false)
    }
  }

  const submitOrder = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (!basket.length || !basketVendor) {
      setFeedback('Add at least one meal before sending the order to a rider.')
      return
    }

    if (!orderForm.customerName || !orderForm.phone || !orderForm.address) {
      setFeedback('Please fill in your name, phone number, and delivery address.')
      return
    }

    setIsSubmitting(true)

    const payload: OrderSubmission = {
      customerName: orderForm.customerName,
      phone: orderForm.phone,
      address: orderForm.address,
      zoneId: orderForm.zoneId,
      notes: orderForm.notes,
      paymentMethod: orderForm.paymentMethod,
      successUrl: `${window.location.origin}/?payment=success`,
      cancelUrl: `${window.location.origin}/?payment=cancel`,
      items: basket.map((entry) => ({
        vendorId: entry.vendorId,
        menuItemId: entry.item.id,
        quantity: entry.quantity,
      })),
    }

    try {
      const response = await fetch('/api/orders', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(session ? { Authorization: `Bearer ${session.token}` } : {}),
        },
        body: JSON.stringify(payload),
      })

      if (!response.ok) {
        throw new Error(await readResponseMessage(response))
      }

      const order = (await response.json()) as OrderRecord
      setLastOrder(order)
      setFeedback(order.message ?? `Order ${order.orderId} captured successfully.`)
      setServiceOnline(true)
      setBasket([])
      setOrderForm((current) => ({
        ...emptyForm,
        zoneId: current.zoneId,
        customerName: session?.user.role === 'customer' ? session.user.name : '',
        phone: session?.user.role === 'customer' ? session.user.phone : '',
      }))

      if (session?.user.role === 'customer') {
        await loadDashboard(session)
      }

      if (order.paymentUrl) {
        window.location.assign(order.paymentUrl)
        return
      }
    } catch (error) {
      setServiceOnline(false)
      setFeedback(error instanceof Error ? error.message : 'Unable to submit the order right now.')
    } finally {
      setIsSubmitting(false)
    }
  }

  const submitPickupRequest = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (!pickupForm.customerName || !pickupForm.phone || !pickupForm.pickupAddress || !pickupForm.dropoffAddress) {
      setFeedback('Please complete your contact details, pickup point, and drop-off address.')
      return
    }

    if (!pickupForm.itemDescription) {
      setFeedback('Describe what the driver should collect before sending the request.')
      return
    }

    setIsSubmitting(true)

    const payload: PickupRequestSubmission = {
      customerName: pickupForm.customerName,
      phone: pickupForm.phone,
      zoneId: pickupForm.zoneId,
      pickupAddress: pickupForm.pickupAddress,
      dropoffAddress: pickupForm.dropoffAddress,
      itemDescription: pickupForm.itemDescription,
      notes: pickupForm.notes,
      paymentMethod: pickupForm.paymentMethod,
    }

    try {
      const response = await fetch('/api/pickup-requests', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(session ? { Authorization: `Bearer ${session.token}` } : {}),
        },
        body: JSON.stringify(payload),
      })

      if (!response.ok) {
        throw new Error(await readResponseMessage(response))
      }

      const pickupRequest = (await response.json()) as PickupRequestRecord
      setLastPickupRequest(pickupRequest)
      setFeedback(pickupRequest.message ?? `Pickup request ${pickupRequest.requestId} captured successfully.`)
      setServiceOnline(true)
      setPickupForm((current) => ({
        ...emptyPickupForm,
        zoneId: current.zoneId,
        customerName: session?.user.role === 'customer' ? session.user.name : '',
        phone: session?.user.role === 'customer' ? session.user.phone : '',
      }))

      if (session?.user.role === 'customer') {
        await loadDashboard(session)
      }
    } catch (error) {
      setServiceOnline(false)
      setFeedback(error instanceof Error ? error.message : 'Unable to submit the pickup request right now.')
    } finally {
      setIsSubmitting(false)
    }
  }

  const advanceOrderStatus = async (orderId: string, status: OrderStatus) => {
    if (!session) {
      return
    }

    setOpsBusy(true)

    try {
      const response = await fetch(`/api/orders/${orderId}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.token}`,
        },
        body: JSON.stringify({ status }),
      })

      if (!response.ok) {
        throw new Error(await readResponseMessage(response))
      }

      const updatedOrder = (await response.json()) as OrderRecord
      setFeedback(updatedOrder.message ?? `Order ${updatedOrder.orderId} updated.`)
      await loadDashboard(session)
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : 'Unable to change the order status.')
      setOpsBusy(false)
    }
  }

  const advancePickupRequestStatus = async (requestId: string, status: PickupRequestStatus) => {
    if (!session) {
      return
    }

    setOpsBusy(true)

    try {
      const response = await fetch(`/api/pickup-requests/${requestId}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.token}`,
        },
        body: JSON.stringify({ status }),
      })

      if (!response.ok) {
        throw new Error(await readResponseMessage(response))
      }

      const updatedRequest = (await response.json()) as PickupRequestRecord
      setFeedback(updatedRequest.message ?? `Pickup request ${updatedRequest.requestId} updated.`)
      await loadDashboard(session)
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : 'Unable to change the pickup request status.')
      setOpsBusy(false)
    }
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-block">
          <span className="brand-mark">KR</span>
          <div>
            <p className="eyebrow">Kwandebele food and pickup runs</p>
            <h1>{appName}</h1>
          </div>
        </div>

        <div className="status-cluster">
          <nav className="topbar-nav" aria-label="Primary">
            <a href="#discover">Restaurants</a>
            <a href="#menu">Menu</a>
            <a href="#checkout">Checkout</a>
            <a href="#runner">Driver pickup</a>
            <a href="#ops">Operations</a>
          </nav>
          <div className="topbar-actions">
            <span className={`status-pill ${serviceOnline ? 'online' : 'offline'}`}>
              <span className="status-dot" />
              {serviceOnline ? 'Dispatch live' : 'Demo mode'}
            </span>
            <a className="header-link-pill" href="#checkout">
              {basketCount} item{basketCount === 1 ? '' : 's'} in basket
            </a>
          </div>
          <p className="status-note">
            {session
              ? `Welcome back, ${session.user.name}. Your ${session.user.role} tools are waiting in the Operations Hub.`
              : 'Browse local restaurants, compare delivery times, or send a driver to collect something for you.'}
          </p>
        </div>
      </header>

      <main className="main-stack">
        <section className="hero-panel">
          <div className="hero-copy">
            <p className="section-tag">Built for after-school cravings, lunch runs, and quick pickup errands.</p>
            <h2>Order local favourites or send a driver to collect what you need around Kwamhlanga and Kwaggafontein.</h2>
            <p className="hero-text">
              Browse real restaurant photos, compare delivery times, and place one clean order with clear
              pickup-point or gate notes. When it is not food, switch to the driver pickup flow and request a
              local runner for documents, parcels, groceries, or pharmacy collections.
            </p>

            <div className="hero-actions">
              <a className="hero-link hero-link-primary" href="#discover">
                Browse restaurants
              </a>
              <a className="hero-link hero-link-secondary" href="#checkout">
                Open basket
              </a>
            </div>

            <div className="hero-benefits" aria-label="Ordering benefits">
              <span className="hero-benefit">Real dish photos</span>
              <span className="hero-benefit">Food and pickup runs</span>
              <span className="hero-benefit">Easy rider notes</span>
            </div>

            <label className="search-field">
              <span>Search by restaurant, dish, or food style</span>
              <input
                type="search"
                placeholder="Try kota, pap bowl, or grilled wings"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </label>

            <div className="sort-row" aria-label="Restaurant sorting">
              {vendorSortOptions.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  className={`sort-chip ${vendorSort === option.id ? 'active' : ''}`}
                  onClick={() => setVendorSort(option.id)}
                >
                  {option.label}
                </button>
              ))}
            </div>

            <div className="zone-switcher" aria-label="Service areas">
              {zones.map((zone) => (
                <button
                  key={zone.id}
                  type="button"
                  className={`zone-chip ${activeZone === zone.id ? 'active' : ''}`}
                  onClick={() => setZone(zone.id)}
                >
                  <strong>{zone.name}</strong>
                  <span>{zone.coverage}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="hero-side">
            <div className="zone-spotlight">
              <p className="spotlight-label">Dispatch in your area</p>
              <h3>{activeZoneDetails.name}</h3>
              <p>{activeZoneDetails.blurb}</p>
              <dl className="spotlight-meta">
                <div>
                  <dt>Typical delivery</dt>
                  <dd>{activeZoneDetails.eta}</dd>
                </div>
                <div>
                  <dt>Coverage</dt>
                  <dd>{activeZoneDetails.coverage}</dd>
                </div>
              </dl>
            </div>

            <div className="stats-grid">
              {stats.map((stat) => (
                <article key={stat.id} className="stat-card">
                  <p className="stat-label">{stat.label}</p>
                  <strong>{stat.value}</strong>
                  <span>{stat.detail}</span>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="experience-strip" aria-label="Storefront highlights">
          <article className="experience-card">
            <p className="section-tag">In your zone</p>
            <h3>{visibleVendors.length} restaurants ready now</h3>
            <p>{activeZoneDetails.coverage}</p>
          </article>
          <article className="experience-card highlight">
            <p className="section-tag">Popular tonight</p>
            <h3>{featuredVendor?.name ?? 'Local favourites'}</h3>
            <p>{featuredVendor?.signatureDish ?? 'Kota builds, pap bowls, grilled wings, and home-style plates.'}</p>
          </article>
          <article className="experience-card">
            <p className="section-tag">Quick runner requests</p>
            <h3>Driver pickup for everyday errands</h3>
            <p>Leave clear rider notes for gates, school pickups, taxi ranks, pharmacies, or family landmarks.</p>
          </article>
        </section>

        <section className="ops-shell" id="ops">
          <div className="panel role-studio">
            <div className="panel-heading">
              <div>
                <p className="section-tag">Access roles</p>
                <h3>Production-minded role setup</h3>
              </div>
              <p className="supporting-copy">
                Each role has its own dashboard, token-protected endpoint, and next-step permissions.
              </p>
            </div>

            <div className="role-grid">
              {demoCredentials.map((credential) => {
                const highlight =
                  roleHighlights.find((role) => role.role === credential.role) ?? roleHighlights[0]

                return (
                  <RolePreviewCard
                    key={credential.role}
                    credential={credential}
                    highlight={highlight}
                    isActive={session?.user.role === credential.role}
                    onUse={() => void signInWithDemo(credential)}
                  />
                )
              })}
            </div>

            <div className="auth-surface">
              <div>
                <p className="section-tag">Auth console</p>
                <h3>{session ? 'Account access is live' : 'Sign in or create a customer account'}</h3>
                <p className="supporting-copy">{authMessage}</p>
              </div>

              <div className="auth-surface-grid">
                <form className="auth-form auth-card" onSubmit={(event) => void submitLogin(event)}>
                  <div className="auth-card-heading">
                    <p className="section-tag">Sign in</p>
                    <h4>{session ? 'Switch to another account' : 'Use existing credentials'}</h4>
                  </div>
                  <label>
                    <span>Email</span>
                    <input
                      name="email"
                      type="email"
                      value={authForm.email}
                      onChange={updateAuthForm}
                      placeholder="customer@kasieats.demo"
                      autoComplete="email"
                      required
                    />
                  </label>
                  <label>
                    <span>Password</span>
                    <input
                      name="password"
                      type="password"
                      value={authForm.password}
                      onChange={updateAuthForm}
                      placeholder="Welcome123!"
                      autoComplete="current-password"
                      minLength={8}
                      required
                    />
                  </label>
                  <div className="auth-actions">
                    <button type="submit" className="submit-button" disabled={authBusy}>
                      {authBusy ? 'Signing in...' : session ? 'Switch account' : 'Sign in'}
                    </button>
                    {session ? (
                      <button
                        type="button"
                        className="secondary-button"
                        onClick={() => clearSession('Signed out successfully.')}
                      >
                        Sign out
                      </button>
                    ) : null}
                  </div>
                </form>

                <form className="auth-form auth-card" onSubmit={(event) => void submitCustomerRegistration(event)}>
                  <div className="auth-card-heading">
                    <p className="section-tag">Customer sign-up</p>
                    <h4>Create a real customer account</h4>
                  </div>
                  <label>
                    <span>Full name</span>
                    <input
                      name="name"
                      value={registerForm.name}
                      onChange={updateRegisterForm}
                      placeholder="Sinethemba Mahlangu"
                      autoComplete="name"
                      required
                    />
                  </label>
                  <div className="form-grid">
                    <label>
                      <span>Email</span>
                      <input
                        name="email"
                        type="email"
                        value={registerForm.email}
                        onChange={updateRegisterForm}
                        placeholder="you@example.com"
                        autoComplete="email"
                        required
                      />
                    </label>
                    <label>
                      <span>Phone</span>
                      <input
                        name="phone"
                        type="tel"
                        value={registerForm.phone}
                        onChange={updateRegisterForm}
                        placeholder="071 234 5678"
                        autoComplete="tel"
                        required
                      />
                    </label>
                  </div>
                  <div className="form-grid">
                    <label>
                      <span>Home zone</span>
                      <select name="zoneId" value={registerForm.zoneId} onChange={updateRegisterForm}>
                        {zones.map((zone) => (
                          <option key={zone.id} value={zone.id}>
                            {zone.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      <span>Password</span>
                      <input
                        name="password"
                        type="password"
                        value={registerForm.password}
                        onChange={updateRegisterForm}
                        placeholder="At least 8 characters"
                        autoComplete="new-password"
                        minLength={8}
                        required
                      />
                    </label>
                  </div>
                  <div className="auth-actions">
                    <button type="submit" className="submit-button" disabled={registerBusy}>
                      {registerBusy ? 'Creating account...' : 'Create customer account'}
                    </button>
                  </div>
                </form>
              </div>

              <p className="supporting-copy auth-note">
                Customer accounts can sign themselves up here. Vendor, rider, and admin accounts are created
                only from the admin dashboard.
              </p>

              {activeRoleHighlight ? (
                <div className="session-highlight" style={{ background: activeRoleHighlight.accent }}>
                  <p className="section-tag">Current access</p>
                  <h4>{activeRoleHighlight.title}</h4>
                  <p>{activeRoleHighlight.summary}</p>
                </div>
              ) : null}
            </div>
          </div>

          <div className="panel dashboard-panel">
            <div className="panel-heading">
              <div>
                <p className="section-tag">Operations dashboards</p>
                <h3>{activeRole ? `${activeRole} view` : 'Sign in to load a dashboard'}</h3>
              </div>
              <p className="supporting-copy">
                {opsBusy
                  ? 'Refreshing live data from the secured API.'
                  : 'Role-specific metrics and next-step buttons are backed by protected routes.'}
              </p>
            </div>

            {customerDashboard ? (
              <div className="dashboard-stack">
                <div className="dashboard-metrics">
                  <MetricTile label="Saved zone" value={customerDashboard.savedZone} />
                  <MetricTile label="Orders tracked" value={String(customerDashboard.orders.length)} />
                  <MetricTile label="Pickup runs" value={String(customerDashboard.pickupRequests.length)} />
                  <MetricTile label="Checkout mode" value={session ? 'Signed in' : 'Guest'} />
                </div>
                <article className="insight-card">
                  <p className="section-tag">Customer note</p>
                  <h4>{customerDashboard.customerName}</h4>
                  <p>{customerDashboard.loyaltyNote}</p>
                </article>
              </div>
            ) : null}

            {vendorDashboard ? (
              <div className="dashboard-stack">
                <div className="dashboard-metrics">
                  <MetricTile label="Queue" value={String(vendorDashboard.queueCount)} />
                  <MetricTile label="Ready now" value={String(vendorDashboard.readyCount)} />
                  <MetricTile label="Avg prep" value={`${vendorDashboard.avgPrepTime} min`} />
                </div>
                <article className="insight-card">
                  <p className="section-tag">Kitchen movers</p>
                  <h4>{vendorDashboard.vendorName}</h4>
                  <div className="pill-row">
                    {vendorDashboard.topItems.map((item) => (
                      <span key={item.name} className="mini-pill">
                        {item.name} x{item.orders}
                      </span>
                    ))}
                  </div>
                </article>
              </div>
            ) : null}

            {riderDashboard ? (
              <div className="dashboard-stack">
                <div className="dashboard-metrics">
                  <MetricTile label="Assigned" value={String(riderDashboard.assignedCount)} />
                  <MetricTile label="Done today" value={String(riderDashboard.completedToday)} />
                  <MetricTile label="Earnings" value={currency.format(riderDashboard.earningsToday)} />
                </div>
                <article className="insight-card">
                  <p className="section-tag">Rider route</p>
                  <h4>{riderDashboard.riderName}</h4>
                  <p>Tasks update when kitchens mark food ready and when customers raise local pickup runs.</p>
                </article>
              </div>
            ) : null}

            {adminOverview ? (
              <div className="dashboard-stack">
                <div className="dashboard-metrics">
                  <MetricTile label="Active orders" value={String(adminOverview.activeOrders)} />
                  <MetricTile label="Active pickups" value={String(adminOverview.activePickupRequests)} />
                  <MetricTile label="Delivered today" value={String(adminOverview.deliveredToday)} />
                  <MetricTile label="Revenue" value={currency.format(adminOverview.revenueToday)} />
                  <MetricTile label="Riders live" value={String(adminOverview.ridersLive)} />
                </div>
                <article className="insight-card">
                  <p className="section-tag">Ops headline</p>
                  <h4>{adminOverview.headline}</h4>
                  <div className="pill-row">
                    {adminOverview.orderStages.map((stage) => (
                      <span key={stage.status} className="mini-pill">
                        {stage.label}: {stage.count}
                      </span>
                    ))}
                    {adminOverview.pickupStages.map((stage) => (
                      <span key={`pickup-${stage.status}`} className="mini-pill">
                        {stage.label}: {stage.count}
                      </span>
                    ))}
                  </div>
                </article>
              </div>
            ) : null}

            {activeRole && dispatchFeed.length > 0 ? (
              <div className="ops-feed">
                {dispatchFeed.map((task) => (
                  <DispatchCard
                    key={task.taskType === 'pickup' ? task.requestId : task.orderId}
                    task={task}
                    busy={opsBusy}
                    onAdvance={
                      activeRole === 'customer'
                        ? undefined
                        : (status) =>
                            task.taskType === 'pickup'
                              ? void advancePickupRequestStatus(task.requestId, status as PickupRequestStatus)
                              : void advanceOrderStatus(task.orderId, status as OrderStatus)
                    }
                  />
                ))}
              </div>
            ) : null}

            {adminOverview ? (
              <article className="insight-card issues-card">
                <p className="section-tag">Priority issues</p>
                <h4>What still needs work</h4>
                <ul>
                  {adminOverview.pendingIssues.map((issue) => (
                    <li key={issue}>{issue}</li>
                  ))}
                </ul>
              </article>
            ) : null}

            {session?.user.role === 'admin' ? (
              <article className="insight-card admin-account-card">
                <p className="section-tag">Provision access</p>
                <h4>Create vendor, rider, and admin accounts</h4>
                <p>
                  Operational roles stay locked behind admin-created accounts so customers cannot register
                  privileged access for themselves.
                </p>

                <form className="auth-form account-create-form" onSubmit={(event) => void submitOperationalUserCreation(event)}>
                  <div className="form-grid">
                    <label>
                      <span>Full name</span>
                      <input
                        name="name"
                        value={adminCreateForm.name}
                        onChange={updateAdminCreateForm}
                        placeholder="Bongani Nkosi"
                        autoComplete="name"
                        required
                      />
                    </label>
                    <label>
                      <span>Role</span>
                      <select name="role" value={adminCreateForm.role} onChange={updateAdminCreateForm}>
                        {operationalRoleOptions.map((roleOption) => (
                          <option key={roleOption.id} value={roleOption.id}>
                            {roleOption.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>

                  <div className="form-grid">
                    <label>
                      <span>Email</span>
                      <input
                        name="email"
                        type="email"
                        value={adminCreateForm.email}
                        onChange={updateAdminCreateForm}
                        placeholder="operator@kasirunner.co.za"
                        autoComplete="email"
                        required
                      />
                    </label>
                    <label>
                      <span>Phone</span>
                      <input
                        name="phone"
                        type="tel"
                        value={adminCreateForm.phone}
                        onChange={updateAdminCreateForm}
                        placeholder="071 555 0105"
                        autoComplete="tel"
                        required
                      />
                    </label>
                  </div>

                  <div className="form-grid">
                    <label>
                      <span>Temporary password</span>
                      <input
                        name="password"
                        type="password"
                        value={adminCreateForm.password}
                        onChange={updateAdminCreateForm}
                        placeholder="At least 8 characters"
                        autoComplete="new-password"
                        minLength={8}
                        required
                      />
                    </label>

                    {adminCreateForm.role === 'vendor' ? (
                      <label>
                        <span>Assigned kitchen</span>
                        <select name="vendorId" value={adminCreateForm.vendorId} onChange={updateAdminCreateForm}>
                          {vendors.map((vendor) => (
                            <option key={vendor.id} value={vendor.id}>
                              {vendor.name}
                            </option>
                          ))}
                        </select>
                      </label>
                    ) : (
                      <div className="zone-selection">
                        <span>Zone coverage</span>
                        <div className="checkbox-grid">
                          {zones.map((zone) => {
                            const isSelected = adminCreateForm.zoneIds.includes(zone.id)

                            return (
                              <label
                                key={zone.id}
                                className={`checkbox-card ${isSelected ? 'selected' : ''}`}
                              >
                                <input
                                  type="checkbox"
                                  checked={isSelected}
                                  onChange={() => toggleAdminZone(zone.id)}
                                />
                                <strong>{zone.name}</strong>
                                <small>{zone.coverage}</small>
                              </label>
                            )
                          })}
                        </div>
                      </div>
                    )}
                  </div>

                  <p className="supporting-copy auth-note">
                    Riders need at least one service zone. Admin accounts can be global or carry optional zone
                    coverage for future scoping.
                  </p>

                  <div className="auth-actions">
                    <button type="submit" className="submit-button" disabled={adminCreateBusy}>
                      {adminCreateBusy ? 'Creating account...' : `Create ${adminCreateForm.role} account`}
                    </button>
                  </div>
                </form>

                {latestProvisionedUser ? (
                  <div className="session-highlight provision-summary">
                    <p className="section-tag">Latest account created</p>
                    <h4>{latestProvisionedUser.name}</h4>
                    <p>{latestProvisionedUser.email}</p>
                    <div className="pill-row">
                      <span className="mini-pill">{latestProvisionedUser.role}</span>
                      {latestProvisionedUser.vendorId ? (
                        <span className="mini-pill">
                          {vendors.find((vendor) => vendor.id === latestProvisionedUser.vendorId)?.name ??
                            latestProvisionedUser.vendorId}
                        </span>
                      ) : null}
                      {latestProvisionedUser.zoneIds?.map((zoneId) => (
                        <span key={zoneId} className="mini-pill">
                          {zones.find((zone) => zone.id === zoneId)?.name ?? zoneId}
                        </span>
                      ))}
                    </div>
                  </div>
                ) : null}
              </article>
            ) : null}

            {!activeRole && !opsBusy ? (
              <article className="empty-state">
                <h4>No dashboard loaded yet</h4>
                <p>Sign in, register a customer, or use any demo role to test the secured operational views.</p>
              </article>
            ) : null}
          </div>
        </section>

        <section className="market-grid" id="discover">
          <div className="market-intro">
            <div>
              <p className="section-tag">Browse local restaurants</p>
              <h2>Your next meal, sorted by area, speed, and cravings.</h2>
              <p className="section-summary">
                Start with the restaurant list, open a menu with photos, then build one clean basket for
                checkout.
              </p>
            </div>
            <div className="section-actions">
              <a className="hero-link hero-link-secondary" href="#menu">
                Jump to menu
              </a>
              <a className="hero-link hero-link-primary" href="#checkout">
                Go to checkout
              </a>
            </div>
          </div>

          <div className="panel vendors-panel">
            <div className="panel-heading">
              <div>
                <p className="section-tag">Available kitchens</p>
                <h3>{visibleVendors.length} local spots running in this zone</h3>
              </div>
              <p className="supporting-copy">
                {trimmedSearch
                  ? `Filtered for "${deferredSearch}".`
                  : `Sorted for ${vendorSortOptions.find((option) => option.id === vendorSort)?.label.toLowerCase()}.`}
              </p>
            </div>

            {featuredVendor ? (
              <article className="featured-vendor" style={{ background: featuredVendor.spotlight }}>
                {featuredVendor.coverImageUrl ? (
                  <img
                    className="featured-vendor-image"
                    src={featuredVendor.coverImageUrl}
                    alt={featuredVendor.name}
                    loading="lazy"
                  />
                ) : null}
                <div className="featured-vendor-overlay">
                  <p className="section-tag light-tag">Featured kitchen</p>
                  <h4>{featuredVendor.name}</h4>
                  <p>{featuredVendor.deliveryNote ?? featuredVendor.description}</p>
                  <div className="pill-row">
                    <span className="featured-pill">{featuredVendor.signatureDish ?? 'House favourite'}</span>
                    <span className="featured-pill">{featuredVendor.rating.toFixed(1)} / 5</span>
                    <span className="featured-pill">{featuredVendor.eta}</span>
                  </div>
                </div>
              </article>
            ) : null}

            <div className="vendor-list">
              {visibleVendors.map((vendor) => (
                <button
                  key={vendor.id}
                  type="button"
                  className={`vendor-card ${selectedVendor?.id === vendor.id ? 'selected' : ''}`}
                  onClick={() => setSelectedVendorId(vendor.id)}
                >
                  <div className="vendor-card-cover" style={{ background: vendor.spotlight }}>
                    {vendor.coverImageUrl ? (
                      <img
                        className="vendor-card-cover-image"
                        src={vendor.coverImageUrl}
                        alt={vendor.name}
                        loading="lazy"
                      />
                    ) : null}
                    <div className="vendor-card-cover-overlay">
                      <span className="vendor-card-mark">{vendor.heroLabel}</span>
                      <div className="vendor-card-cover-copy">
                        <p className="vendor-area">{vendor.area}</p>
                        <h4>{vendor.name}</h4>
                        <p>{vendor.tagline}</p>
                      </div>
                    </div>
                  </div>
                  <p className="vendor-tagline">{vendor.signatureDish ?? vendor.tagline}</p>
                  <div className="vendor-meta">
                    <span>{vendor.rating.toFixed(1)} / 5</span>
                    <span>{vendor.eta}</span>
                    <span>{currency.format(vendor.deliveryFee)} delivery</span>
                  </div>
                  <div className="vendor-categories">
                    {vendor.categories.map((category) => (
                      <span key={category}>{category}</span>
                    ))}
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div className="panel menu-panel" id="menu">
            {selectedVendor ? (
              <>
                <div className="menu-hero" style={{ background: selectedVendor.spotlight }}>
                  {selectedVendor.coverImageUrl ? (
                    <img
                      className="menu-hero-image"
                      src={selectedVendor.coverImageUrl}
                      alt={selectedVendor.name}
                      loading="lazy"
                    />
                  ) : null}
                  <div className="menu-hero-overlay">
                    <div className="menu-hero-copy">
                      <p className="section-tag light-tag">Kitchen selected</p>
                      <h3>{selectedVendor.name}</h3>
                      <p>{selectedVendor.description}</p>
                      <div className="menu-hero-meta">
                        <span className="featured-pill">{selectedVendor.rating.toFixed(1)} / 5</span>
                        <span className="featured-pill">{selectedVendor.eta}</span>
                        <span className="featured-pill">{currency.format(selectedVendor.deliveryFee)} delivery</span>
                      </div>
                      <span className="menu-hero-note">
                        {selectedVendor.deliveryNote ?? selectedVendor.signatureDish ?? selectedVendor.tagline}
                      </span>
                    </div>
                    <div className="menu-hero-mark">{selectedVendor.heroLabel}</div>
                  </div>
                </div>

                {selectedVendorGallery.length ? (
                  <div className="menu-gallery">
                    {selectedVendorGallery.map((imageUrl) => (
                      <img
                        key={imageUrl}
                        className="menu-gallery-shot"
                        src={imageUrl}
                        alt={`${selectedVendor.name} dish`}
                        loading="lazy"
                      />
                    ))}
                  </div>
                ) : null}

                <div className="menu-heading">
                  <div>
                    <p className="section-tag">Menu board</p>
                    <h3>Full menu from {selectedVendor.name}</h3>
                  </div>
                  <p className="supporting-copy">
                    Browse dish photos, compare prep times, and add what you want without leaving the
                    restaurant view.
                  </p>
                </div>

                <div className="menu-list">
                  {selectedVendor.menu.map((item) => (
                    <article key={item.id} className="menu-card">
                      <div className="menu-card-top">
                        {item.imageUrl || selectedVendor.coverImageUrl ? (
                          <img
                            className="menu-item-image"
                            src={item.imageUrl ?? selectedVendor.coverImageUrl}
                            alt={item.name}
                            loading="lazy"
                          />
                        ) : null}
                        <div className="menu-copy">
                          <div className="menu-title-row">
                            <h4>{item.name}</h4>
                            {item.badge ? <span className="menu-badge">{item.badge}</span> : null}
                          </div>
                          <p>{item.description}</p>
                          <div className="pill-row">
                            <span className="mini-pill">{selectedVendor.name}</span>
                            <span className="mini-pill">{item.prepMinutes} min</span>
                          </div>
                        </div>
                      </div>
                      <div className="menu-footer">
                        <div>
                          <strong>{currency.format(item.price)}</strong>
                          <span>Ready in about {item.prepMinutes} min</span>
                        </div>
                        <button type="button" onClick={() => addToBasket(selectedVendor, item.id)}>
                          Add
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              </>
            ) : (
              <article className="empty-state">
                <h4>Select a kitchen to browse the menu</h4>
                <p>The list will update based on your chosen service area.</p>
              </article>
            )}
          </div>

          <aside className="panel basket-panel" id="checkout">
            <div className="basket-top">
              <div>
                <p className="section-tag">Current basket</p>
                <h3>{basketCount} item{basketCount === 1 ? '' : 's'}</h3>
              </div>
              {basketCount > 0 ? (
                <button type="button" className="text-button" onClick={clearBasket}>
                  Clear all
                </button>
              ) : null}
            </div>

            <p className="feedback-note">{feedback}</p>

            <div className="basket-items">
              {basket.map((entry) => (
                <article key={entry.item.id} className="basket-item">
                  <div>
                    <h4>{entry.item.name}</h4>
                    <p>{currency.format(entry.item.price)} each</p>
                  </div>
                  <div className="basket-quantity">
                    <button
                      type="button"
                      aria-label={`Decrease ${entry.item.name}`}
                      onClick={() => changeBasketQuantity(entry.item.id, entry.quantity - 1)}
                    >
                      -
                    </button>
                    <strong>{entry.quantity}</strong>
                    <button
                      type="button"
                      aria-label={`Increase ${entry.item.name}`}
                      onClick={() => changeBasketQuantity(entry.item.id, entry.quantity + 1)}
                    >
                      +
                    </button>
                  </div>
                </article>
              ))}

              {!basket.length ? (
                <article className="basket-empty">
                  <h4>Basket is empty</h4>
                  <p>Pick a kitchen first, then add meals here for checkout.</p>
                </article>
              ) : null}
            </div>

            <dl className="bill-summary">
              <div>
                <dt>Food subtotal</dt>
                <dd>{currency.format(subtotal)}</dd>
              </div>
              <div>
                <dt>Delivery</dt>
                <dd>{currency.format(deliveryFee)}</dd>
              </div>
              <div className="bill-total">
                <dt>Total</dt>
                <dd>{currency.format(total)}</dd>
              </div>
            </dl>

            <form className="checkout-form" onSubmit={(event) => void submitOrder(event)}>
              <div className="form-grid">
                <label>
                  <span>Customer name</span>
                  <input
                    name="customerName"
                    placeholder="Sinethemba Mahlangu"
                    value={orderForm.customerName}
                    onChange={updateOrderForm}
                  />
                </label>
                <label>
                  <span>Phone number</span>
                  <input
                    name="phone"
                    placeholder="071 234 5678"
                    value={orderForm.phone}
                    onChange={updateOrderForm}
                  />
                </label>
              </div>

              <label>
                <span>Delivery area</span>
                <select name="zoneId" value={orderForm.zoneId} onChange={updateOrderForm}>
                  {zones.map((zone) => (
                    <option key={zone.id} value={zone.id}>
                      {zone.name}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                <span>Street or pickup point</span>
                <textarea
                  name="address"
                  rows={3}
                  placeholder="House number, street, extension, school gate, or taxi rank landmark"
                  value={orderForm.address}
                  onChange={updateOrderForm}
                />
              </label>

              <label>
                <span>Payment option</span>
                <select
                  name="paymentMethod"
                  value={orderForm.paymentMethod}
                  onChange={updateOrderForm}
                >
                  <option value="cash">Cash on delivery</option>
                  <option value="card">Card with secure checkout</option>
                  <option value="ewallet">eWallet / transfer</option>
                </select>
              </label>

              <label>
                <span>Driver notes</span>
                <textarea
                  name="notes"
                  rows={2}
                  placeholder="Any landmark, gate color, or call-before-arrival note"
                  value={orderForm.notes}
                  onChange={updateOrderForm}
                />
              </label>

              <button type="submit" className="submit-button" disabled={isSubmitting}>
                {isSubmitting ? 'Sending order...' : 'Request food delivery'}
              </button>
            </form>

            {lastOrder ? (
              <article className="order-card latest-order">
                <p className="section-tag">Latest order</p>
                <h4>{lastOrder.orderId}</h4>
                <p>
                  {lastOrder.vendorName} | {lastOrder.zoneName} | {lastOrder.eta}
                </p>
                <TrackingRail steps={lastOrder.trackingSteps} />
              </article>
            ) : null}

            <div className="section-divider" id="runner">
              <p className="section-tag">Driver pickup</p>
              <h3>Need a driver to collect something for you?</h3>
              <p className="supporting-copy">
                Send a pickup run for pharmacy parcels, forgotten groceries, documents, or other items already
                waiting at a collection point.
              </p>
            </div>

            <dl className="bill-summary pickup-fee-summary">
              <div>
                <dt>Pickup fee</dt>
                <dd>{currency.format(estimatePickupServiceFee(pickupForm.zoneId))}</dd>
              </div>
              <div>
                <dt>Payment</dt>
                <dd>{pickupForm.paymentMethod === 'cash' ? 'Cash on handoff' : 'eWallet transfer'}</dd>
              </div>
            </dl>

            <form className="checkout-form" onSubmit={(event) => void submitPickupRequest(event)}>
              <div className="form-grid">
                <label>
                  <span>Customer name</span>
                  <input
                    name="customerName"
                    placeholder="Sinethemba Mahlangu"
                    value={pickupForm.customerName}
                    onChange={updatePickupForm}
                  />
                </label>
                <label>
                  <span>Phone number</span>
                  <input
                    name="phone"
                    placeholder="071 234 5678"
                    value={pickupForm.phone}
                    onChange={updatePickupForm}
                  />
                </label>
              </div>

              <label>
                <span>Pickup zone</span>
                <select name="zoneId" value={pickupForm.zoneId} onChange={updatePickupForm}>
                  {zones.map((zone) => (
                    <option key={zone.id} value={zone.id}>
                      {zone.name}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                <span>Collection point</span>
                <textarea
                  name="pickupAddress"
                  rows={3}
                  placeholder="Store counter, clinic desk, school office, or any clear landmark"
                  value={pickupForm.pickupAddress}
                  onChange={updatePickupForm}
                />
              </label>

              <label>
                <span>Drop-off point</span>
                <textarea
                  name="dropoffAddress"
                  rows={3}
                  placeholder="House number, gate color, taxi rank, or nearby landmark"
                  value={pickupForm.dropoffAddress}
                  onChange={updatePickupForm}
                />
              </label>

              <label>
                <span>What should the driver collect?</span>
                <textarea
                  name="itemDescription"
                  rows={2}
                  placeholder="Describe the parcel, item, or document waiting for collection"
                  value={pickupForm.itemDescription}
                  onChange={updatePickupForm}
                />
              </label>

              <label>
                <span>Payment option</span>
                <select
                  name="paymentMethod"
                  value={pickupForm.paymentMethod}
                  onChange={updatePickupForm}
                >
                  <option value="cash">Cash on handoff</option>
                  <option value="ewallet">eWallet / transfer</option>
                </select>
              </label>

              <label>
                <span>Driver notes</span>
                <textarea
                  name="notes"
                  rows={2}
                  placeholder="Collection code, person to ask for, or any special handling note"
                  value={pickupForm.notes}
                  onChange={updatePickupForm}
                />
              </label>

              <button type="submit" className="submit-button" disabled={isSubmitting}>
                {isSubmitting ? 'Sending pickup...' : 'Request driver pickup'}
              </button>
            </form>

            {lastPickupRequest ? (
              <article className="order-card latest-order pickup-preview-card">
                <p className="section-tag">Latest pickup request</p>
                <h4>{lastPickupRequest.requestId}</h4>
                <p>
                  {lastPickupRequest.zoneName} | {lastPickupRequest.eta} | {currency.format(lastPickupRequest.serviceFee)}
                </p>
                <p>{lastPickupRequest.itemDescription}</p>
                <TrackingRail steps={lastPickupRequest.trackingSteps} />
              </article>
            ) : null}
          </aside>
        </section>

        <section className="trust-grid">
          <article className="trust-card">
            <p className="section-tag">Easy ordering</p>
            <h3>Restaurant browsing that feels clear from the first click</h3>
            <p>
              Start with the area you are in, compare real food photos, then move through one clean basket
              instead of hopping between screens.
            </p>
          </article>
          <article className="trust-card">
            <p className="section-tag">Local runner service</p>
            <h3>Built for landmarks, school gates, taxi ranks, and counter collections</h3>
            <p>
              Driver notes now cover both food drop-offs and personal pickup runs, so riders can work with
              gate colors, clinics, shops, and familiar township landmarks.
            </p>
          </article>
          <article className="trust-card">
            <p className="section-tag">Flexible dispatch</p>
            <h3>One app for meals, parcels, and live rider progress</h3>
            <p>
              Customers can still choose flexible food payments, while pickup runs add a quick driver request
              flow for everyday errands already waiting for collection.
            </p>
          </article>
        </section>
      </main>
    </div>
  )
}

interface MetricTileProps {
  label: string
  value: string
}

function MetricTile({ label, value }: MetricTileProps) {
  return (
    <article className="metric-tile">
      <p>{label}</p>
      <strong>{value}</strong>
    </article>
  )
}

interface RolePreviewCardProps {
  credential: DemoCredential
  highlight: RoleHighlight
  isActive: boolean
  onUse: () => void
}

function RolePreviewCard({ credential, highlight, isActive, onUse }: RolePreviewCardProps) {
  return (
    <article className={`role-preview ${isActive ? 'active' : ''}`} style={{ background: highlight.accent }}>
      <div className="role-preview-top">
        <div className="role-preview-badge" style={{ background: credential.accent }}>
          {credential.label.slice(0, 1)}
        </div>
        <div>
          <p className="section-tag">{credential.role}</p>
          <h4>{highlight.title}</h4>
        </div>
      </div>
      <p>{credential.summary}</p>
      <div className="credential-line">
        <code>{credential.email}</code>
        <code>{credential.password}</code>
      </div>
      <ul className="role-capabilities">
        {highlight.capabilities.map((capability) => (
          <li key={capability}>{capability}</li>
        ))}
      </ul>
      <button type="button" className="secondary-button" onClick={onUse}>
        Use {credential.label}
      </button>
    </article>
  )
}

interface DispatchCardProps {
  task: DispatchRecord
  busy: boolean
  onAdvance?: (status: OrderStatus | PickupRequestStatus) => void
}

function DispatchCard({ task, busy, onAdvance }: DispatchCardProps) {
  return (
    <article className="order-card">
      <div className="order-topline">
        <div>
          <p className="section-tag">{task.statusLabel}</p>
          <h4>{task.taskType === 'pickup' ? task.requestId : task.orderId}</h4>
        </div>
        <span className="status-chip">{task.taskType === 'pickup' ? 'Driver pickup' : task.vendorName}</span>
      </div>

      {task.taskType === 'pickup' ? (
        <>
          <p className="order-meta">
            {task.customerName} | {task.zoneName} | {task.eta}
          </p>
          <p className="order-meta">Collect: {task.pickupAddress}</p>
          <p className="order-meta">Drop-off: {task.dropoffAddress}</p>
        </>
      ) : (
        <>
          <p className="order-meta">
            {task.customerName} | {task.zoneName} | {task.eta}
          </p>
          <p className="order-meta">{task.address}</p>
        </>
      )}

      <div className="pill-row">
        <span className="mini-pill">{task.paymentStatusLabel}</span>
        {task.taskType === 'pickup' ? (
          <span className="mini-pill">{currency.format(task.serviceFee)} runner fee</span>
        ) : (
          task.items.map((item) => (
            <span key={item.id} className="mini-pill">
              {item.name} x{item.quantity}
            </span>
          ))
        )}
        {task.assignedRiderName ? <span className="mini-pill">{task.assignedRiderName}</span> : null}
      </div>

      {task.taskType === 'pickup' ? <p className="order-meta">{task.itemDescription}</p> : null}

      <TrackingRail steps={task.trackingSteps} />

      {task.allowedNextStatuses.length > 0 && onAdvance ? (
        <div className="order-actions">
          {task.allowedNextStatuses.map((status) => (
            <button
              key={status}
              type="button"
              className="secondary-button"
              disabled={busy}
              onClick={() => onAdvance(status)}
            >
              {getTaskActionLabel(task, status)}
            </button>
          ))}
        </div>
      ) : null}
    </article>
  )
}

interface TrackingRailProps {
  steps: TrackingStep[]
}

function TrackingRail({ steps }: TrackingRailProps) {
  return (
    <ol className="tracking-rail">
      {steps.map((step) => (
        <li key={step.id} className={`tracking-step ${step.state}`}>
          <span />
          <small>{step.label}</small>
        </li>
      ))}
    </ol>
  )
}

export default App
