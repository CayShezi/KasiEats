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
  OrderFormState,
  OrderRecord,
  OrderStatus,
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

const currency = new Intl.NumberFormat('en-ZA', {
  style: 'currency',
  currency: 'ZAR',
  maximumFractionDigits: 0,
})

const storageKey = 'kasieats.session'
const defaultZone = zones[0]?.id ?? 'kwamhlanga'
const dashboardRoutes: Record<UserRole, string> = {
  customer: '/api/customer/dashboard',
  vendor: '/api/vendor/dashboard',
  rider: '/api/rider/dashboard',
  admin: '/api/admin/overview',
}
const nextActionLabels: Record<OrderStatus, string> = {
  placed: 'Placed',
  accepted: 'Accept order',
  preparing: 'Start prep',
  ready: 'Mark ready',
  'on-route': 'Hand to rider',
  delivered: 'Close order',
}
const vendorSortOptions = [
  { id: 'trending', label: 'Trending' },
  { id: 'rating', label: 'Top rated' },
  { id: 'fastest', label: 'Fastest' },
  { id: 'delivery', label: 'Lowest fee' },
] as const

const emptyForm: OrderFormState = {
  customerName: '',
  phone: '',
  address: '',
  zoneId: defaultZone,
  notes: '',
  paymentMethod: 'cash',
}

async function readResponseMessage(response: Response) {
  try {
    const payload = (await response.json()) as { message?: string }
    return payload.message ?? `Request failed with status ${response.status}.`
  } catch {
    return `Request failed with status ${response.status}.`
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

  return 'Production foundation is live: demo accounts, role gates, and dispatch-ready ordering.'
}

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

function App() {
  const [vendors, setVendors] = useState<Vendor[]>(seedVendors)
  const [stats, setStats] = useState<ServiceStat[]>(seedStats)
  const [activeZone, setActiveZone] = useState<ZoneId>(defaultZone)
  const [selectedVendorId, setSelectedVendorId] = useState(seedVendors[0]?.id ?? '')
  const [search, setSearch] = useState('')
  const [vendorSort, setVendorSort] = useState<(typeof vendorSortOptions)[number]['id']>('trending')
  const [basket, setBasket] = useState<BasketEntry[]>([])
  const [orderForm, setOrderForm] = useState<OrderFormState>(emptyForm)
  const [serviceOnline, setServiceOnline] = useState(false)
  const [feedback, setFeedback] = useState(readCheckoutFeedbackFromLocation)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [lastOrder, setLastOrder] = useState<OrderRecord | null>(null)
  const [session, setSession] = useState<AuthSession | null>(null)
  const [authForm, setAuthForm] = useState({
    email: demoCredentials[0]?.email ?? '',
    password: demoCredentials[0]?.password ?? '',
  })
  const [authBusy, setAuthBusy] = useState(false)
  const [authMessage, setAuthMessage] = useState(
    'Use the seeded demo roles to test customer, vendor, rider, and admin flows.',
  )
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
    localStorage.setItem(storageKey, JSON.stringify(nextSession))
  }

  const clearSession = (message?: string) => {
    setSession(null)
    clearDashboards()
    localStorage.removeItem(storageKey)

    if (message) {
      setAuthMessage(message)
    }
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

      persistSession(nextSession)
      setOrderForm((current) => ({
        ...current,
        customerName:
          nextSession.user.role === 'customer' ? current.customerName || nextSession.user.name : current.customerName,
        phone: nextSession.user.role === 'customer' ? current.phone || nextSession.user.phone : current.phone,
      }))
      setAuthMessage(`Welcome back, ${payload.user.name}.`)
      await loadDashboard(nextSession)
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
    const saved = localStorage.getItem(storageKey)

    if (!saved) {
      return
    }

    try {
      const parsed = JSON.parse(saved) as AuthSession
      queueMicrotask(() => {
        void restoreSavedSession(parsed)
      })
    } catch {
      localStorage.removeItem(storageKey)
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
  const ordersForOps =
    customerDashboard?.orders ??
    vendorDashboard?.liveOrders ??
    riderDashboard?.tasks ??
    adminOverview?.liveOrders ??
    []

  const setZone = (zoneId: ZoneId) => {
    startTransition(() => {
      setActiveZone(zoneId)
      setOrderForm((current) => ({ ...current, zoneId }))
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

  const updateAuthForm = (event: ChangeEvent<HTMLInputElement>) => {
    const { name, value } = event.target
    setAuthForm((current) => ({ ...current, [name]: value }))
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
      persistSession(nextSession)
      setOrderForm((current) => ({
        ...current,
        customerName:
          nextSession.user.role === 'customer' ? current.customerName || nextSession.user.name : current.customerName,
        phone: nextSession.user.role === 'customer' ? current.phone || nextSession.user.phone : current.phone,
      }))
      setAuthMessage(`Signed in as ${nextSession.user.name} (${nextSession.user.role}).`)
      setFeedback(`Role gates are active for ${nextSession.user.role}.`)
      await loadDashboard(nextSession)
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

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-block">
          <span className="brand-mark">KE</span>
          <div>
            <p className="eyebrow">Kwandebele community delivery</p>
            <h1>KasiEats</h1>
          </div>
        </div>

        <div className="status-cluster">
          <span className={`status-pill ${serviceOnline ? 'online' : 'offline'}`}>
            <span className="status-dot" />
            {serviceOnline ? 'Dispatch live' : 'Fallback mode'}
          </span>
          <p className="status-note">
            {session
              ? `Signed in as ${session.user.name} with ${session.user.role} access.`
              : 'Customer, vendor, rider, and admin roles are ready for testing.'}
          </p>
        </div>
      </header>

      <main className="main-stack">
        <section className="hero-panel">
          <div className="hero-copy">
            <p className="section-tag">Built for after-school cravings and supper runs.</p>
            <h2>Township delivery with real roles, stronger ops, and a mobile-first future.</h2>
            <p className="hero-text">
              KasiEats now separates customer ordering, kitchen operations, rider dispatch, and admin
              oversight so the platform can scale beyond a landing page into a proper local-delivery
              system.
            </p>

            <label className="search-field">
              <span>Search by vendor, dish, or style</span>
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
              <p className="spotlight-label">Tonight&apos;s spotlight</p>
              <h3>{activeZoneDetails.name}</h3>
              <p>{activeZoneDetails.blurb}</p>
              <dl className="spotlight-meta">
                <div>
                  <dt>Estimated route</dt>
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

        <section className="ops-shell">
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
                <h3>{session ? 'Active operational session' : 'Sign in to a role'}</h3>
                <p className="supporting-copy">{authMessage}</p>
              </div>

              <form className="auth-form" onSubmit={(event) => void submitLogin(event)}>
                <label>
                  <span>Email</span>
                  <input
                    name="email"
                    value={authForm.email}
                    onChange={updateAuthForm}
                    placeholder="customer@kasieats.demo"
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
                  <p>Tasks update when a kitchen marks an order ready or when the rider closes delivery.</p>
                </article>
              </div>
            ) : null}

            {adminOverview ? (
              <div className="dashboard-stack">
                <div className="dashboard-metrics">
                  <MetricTile label="Active orders" value={String(adminOverview.activeOrders)} />
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
                  </div>
                </article>
              </div>
            ) : null}

            {activeRole && ordersForOps.length > 0 ? (
              <div className="ops-feed">
                {ordersForOps.map((order) => (
                  <OrderCard
                    key={order.orderId}
                    order={order}
                    busy={opsBusy}
                    onAdvance={
                      activeRole === 'customer'
                        ? undefined
                        : (status) => void advanceOrderStatus(order.orderId, status)
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

            {!activeRole && !opsBusy ? (
              <article className="empty-state">
                <h4>No dashboard loaded yet</h4>
                <p>Choose any demo role to test the secured operational views.</p>
              </article>
            ) : null}
          </div>
        </section>

        <section className="market-grid">
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

          <div className="panel menu-panel">
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
                    <h3>Restaurant-first browsing with clearer dish photos</h3>
                  </div>
                  <p className="supporting-copy">
                    Browse dishes by restaurant, see what the kitchen is known for, then build a clean single-store basket.
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

          <aside className="panel basket-panel">
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
                {isSubmitting ? 'Sending order...' : 'Request a rider'}
              </button>
            </form>

            {lastOrder ? (
              <article className="order-card latest-order">
                <p className="section-tag">Latest order</p>
                <h4>{lastOrder.orderId}</h4>
                <p>
                  {lastOrder.vendorName} for {lastOrder.zoneName} · {lastOrder.eta}
                </p>
                <TrackingRail steps={lastOrder.trackingSteps} />
              </article>
            ) : null}
          </aside>
        </section>

        <section className="trust-grid">
          <article className="trust-card">
            <p className="section-tag">Security layer</p>
            <h3>JWT sessions, validation, and role-gated operations</h3>
            <p>
              The API now uses input validation, token-based auth, and per-role transitions so kitchens,
              riders, and admins only see the flows they should manage.
            </p>
          </article>
          <article className="trust-card">
            <p className="section-tag">Mobile ready</p>
            <h3>A separate Expo app now lives in this repo</h3>
            <p>
              The mobile client is built as its own app so customer ordering and operations can grow into
              a stronger Android and iOS experience without bending the web code.
            </p>
          </article>
          <article className="trust-card">
            <p className="section-tag">Next production step</p>
            <h3>SQLite, Stripe checkout, and Expo push are now wired in</h3>
            <p>
              Orders now persist in SQLite, card payments can move through hosted checkout, and the mobile
              app can register Expo push tokens for live dispatch updates.
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

interface OrderCardProps {
  order: OrderRecord
  busy: boolean
  onAdvance?: (status: OrderStatus) => void
}

function OrderCard({ order, busy, onAdvance }: OrderCardProps) {
  return (
    <article className="order-card">
      <div className="order-topline">
        <div>
          <p className="section-tag">{order.statusLabel}</p>
          <h4>{order.orderId}</h4>
        </div>
        <span className="status-chip">{order.vendorName}</span>
      </div>

      <p className="order-meta">
        {order.customerName} · {order.zoneName} · {order.eta}
      </p>
      <p className="order-meta">{order.address}</p>

      <div className="pill-row">
        <span className="mini-pill">{order.paymentStatusLabel}</span>
        {order.items.map((item) => (
          <span key={item.id} className="mini-pill">
            {item.name} x{item.quantity}
          </span>
        ))}
      </div>

      <TrackingRail steps={order.trackingSteps} />

      {order.allowedNextStatuses.length > 0 && onAdvance ? (
        <div className="order-actions">
          {order.allowedNextStatuses.map((status) => (
            <button
              key={status}
              type="button"
              className="secondary-button"
              disabled={busy}
              onClick={() => onAdvance(status)}
            >
              {nextActionLabels[status]}
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
