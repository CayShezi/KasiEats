import { useDeferredValue, useEffect, useState, startTransition } from 'react'
import './App.css'
import { seedStats, seedVendors, zones } from './data'
import type {
  BasketEntry,
  OrderFormState,
  OrderResponse,
  OrderSubmission,
  ServiceStat,
  Vendor,
  ZoneId,
} from './types'

const currency = new Intl.NumberFormat('en-ZA', {
  style: 'currency',
  currency: 'ZAR',
  maximumFractionDigits: 0,
})

const defaultZone = zones[0]?.id ?? 'kwamhlanga'

const emptyForm: OrderFormState = {
  customerName: '',
  phone: '',
  address: '',
  zoneId: defaultZone,
  notes: '',
  paymentMethod: 'cash',
}

function App() {
  const [vendors, setVendors] = useState<Vendor[]>(seedVendors)
  const [stats, setStats] = useState<ServiceStat[]>(seedStats)
  const [activeZone, setActiveZone] = useState<ZoneId>(defaultZone)
  const [selectedVendorId, setSelectedVendorId] = useState(seedVendors[0]?.id ?? '')
  const [search, setSearch] = useState('')
  const [basket, setBasket] = useState<BasketEntry[]>([])
  const [orderForm, setOrderForm] = useState<OrderFormState>(emptyForm)
  const [serviceOnline, setServiceOnline] = useState(false)
  const [feedback, setFeedback] = useState(
    'Serving township favourites with simple pickup points and rider routing.',
  )
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [lastOrder, setLastOrder] = useState<OrderResponse | null>(null)
  const deferredSearch = useDeferredValue(search)

  useEffect(() => {
    let ignore = false

    async function loadMarketplace() {
      try {
        const [vendorsResponse, statsResponse] = await Promise.all([
          fetch('/api/vendors'),
          fetch('/api/stats'),
        ])

        if (!vendorsResponse.ok || !statsResponse.ok) {
          throw new Error('Marketplace service unavailable')
        }

        const vendorsPayload = (await vendorsResponse.json()) as Vendor[]
        const statsPayload = (await statsResponse.json()) as ServiceStat[]

        if (!ignore) {
          setVendors(vendorsPayload)
          setStats(statsPayload)
          setServiceOnline(true)
          setFeedback('Live dispatch is online and syncing with the local rider queue.')
        }
      } catch {
        if (!ignore) {
          setServiceOnline(false)
          setFeedback('Demo mode is ready. The app still works while the live service boots up.')
        }
      }
    }

    void loadMarketplace()

    return () => {
      ignore = true
    }
  }, [])

  const trimmedSearch = deferredSearch.trim().toLowerCase()
  const visibleVendors = vendors.filter((vendor) => {
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
      vendor.menu.map((item) => `${item.name} ${item.description}`).join(' '),
    ]
      .join(' ')
      .toLowerCase()

    return matchesZone && searchableText.includes(trimmedSearch)
  })

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
  const subtotal = basket.reduce(
    (total, entry) => total + entry.item.price * entry.quantity,
    0,
  )
  const deliveryFee = basketCount > 0 && basketVendor ? basketVendor.deliveryFee : 0
  const total = subtotal + deliveryFee
  const activeZoneDetails = zones.find((zone) => zone.id === activeZone) ?? zones[0]

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
    event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>,
  ) => {
    const field = event.target.name as keyof OrderFormState
    const value = event.target.value

    setOrderForm((current) => ({
      ...current,
      [field]: value as OrderFormState[typeof field],
    }))
  }

  const submitOrder = async (event: React.FormEvent<HTMLFormElement>) => {
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
        },
        body: JSON.stringify(payload),
      })

      if (!response.ok) {
        throw new Error('Order service unavailable')
      }

      const order = (await response.json()) as OrderResponse
      setLastOrder(order)
      setServiceOnline(true)
      setFeedback(order.message)
    } catch {
      const eta = orderForm.zoneId === 'kwaggafontein' ? '28-36 min' : '22-30 min'
      const fallbackOrder: OrderResponse = {
        orderId: `KE-DEMO-${Math.floor(1000 + Math.random() * 9000)}`,
        eta,
        message:
          'The order was captured in demo mode. Connect the local API to dispatch it live.',
        trackingSteps: [
          'Kitchen confirmed the basket',
          'Nearest rider reserved the trip',
          'Drop-off pin saved for the community route',
        ],
      }

      setLastOrder(fallbackOrder)
      setServiceOnline(false)
      setFeedback(fallbackOrder.message)
    } finally {
      setIsSubmitting(false)
      setBasket([])
      setOrderForm((current) => ({
        ...emptyForm,
        zoneId: current.zoneId,
      }))
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
            {serviceOnline ? 'Dispatch live' : 'Demo mode'}
          </span>
          <p className="status-note">Tonight&apos;s routing focuses on homes, schools, and taxi ranks.</p>
        </div>
      </header>

      <main className="main-stack">
        <section className="hero-panel">
          <div className="hero-copy">
            <p className="section-tag">Built for after-school cravings and supper runs.</p>
            <h2>Fast local food delivery for Kwamhlanga and Kwaggafontein.</h2>
            <p className="hero-text">
              This MVP is designed for township delivery: easier address capture, trusted drop points,
              and menus from local kitchens that already know the neighbourhood pace.
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
                  : 'Choose a kitchen, then build one basket for a smooth rider trip.'}
              </p>
            </div>

            <div className="vendor-list">
              {visibleVendors.map((vendor) => (
                <button
                  key={vendor.id}
                  type="button"
                  className={`vendor-card ${selectedVendor?.id === vendor.id ? 'selected' : ''}`}
                  onClick={() => setSelectedVendorId(vendor.id)}
                >
                  <div className="vendor-card-top">
                    <div className="vendor-glow" style={{ background: vendor.spotlight }}>
                      <span>{vendor.heroLabel}</span>
                    </div>
                    <div>
                      <p className="vendor-area">{vendor.area}</p>
                      <h4>{vendor.name}</h4>
                    </div>
                  </div>
                  <p className="vendor-tagline">{vendor.tagline}</p>
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

              {!visibleVendors.length ? (
                <article className="empty-state">
                  <h4>No kitchens matched that search</h4>
                  <p>Try a broader dish name or switch back to another service zone.</p>
                </article>
              ) : null}
            </div>
          </div>

          <div className="panel menu-panel">
            {selectedVendor ? (
              <>
                <div className="menu-hero" style={{ background: selectedVendor.spotlight }}>
                  <div>
                    <p className="section-tag light-tag">Kitchen selected</p>
                    <h3>{selectedVendor.name}</h3>
                    <p>{selectedVendor.description}</p>
                  </div>
                  <div className="menu-hero-mark">{selectedVendor.heroLabel}</div>
                </div>

                <div className="menu-heading">
                  <div>
                    <p className="section-tag">Menu board</p>
                    <h3>What people are ordering right now</h3>
                  </div>
                  <p className="supporting-copy">
                    One basket per rider keeps handover quick and reduces missed turns.
                  </p>
                </div>

                <div className="menu-list">
                  {selectedVendor.menu.map((item) => (
                    <article key={item.id} className="menu-card">
                      <div className="menu-copy">
                        <div className="menu-title-row">
                          <h4>{item.name}</h4>
                          {item.badge ? <span className="menu-badge">{item.badge}</span> : null}
                        </div>
                        <p>{item.description}</p>
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

            <form className="checkout-form" onSubmit={submitOrder}>
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
                  <option value="card">Card on arrival</option>
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
              <article className="order-card">
                <p className="section-tag">Latest order</p>
                <h4>{lastOrder.orderId}</h4>
                <p>{lastOrder.eta}</p>
                <ul>
                  {lastOrder.trackingSteps.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ul>
              </article>
            ) : null}
          </aside>
        </section>

        <section className="trust-grid">
          <article className="trust-card">
            <p className="section-tag">Trust the route</p>
            <h3>Drop points that make sense locally</h3>
            <p>
              Homes, corners, church gates, school entrances, and taxi-rank landmarks can all be saved
              as delivery instructions.
            </p>
          </article>
          <article className="trust-card">
            <p className="section-tag">Flexible payments</p>
            <h3>Cash, card, or digital handoff</h3>
            <p>
              The checkout keeps low-friction options for neighbourhood orders where not every customer
              wants to pay online first.
            </p>
          </article>
          <article className="trust-card">
            <p className="section-tag">Merchant friendly</p>
            <h3>Built for local kitchens and spaza food brands</h3>
            <p>
              One app can support home-based sellers, grill spots, and township pizza counters without
              forcing a city-only delivery model.
            </p>
          </article>
        </section>
      </main>
    </div>
  )
}

export default App
