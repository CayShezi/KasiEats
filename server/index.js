import express from 'express'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { stats, vendors, zones } from './data.js'

const app = express()
const port = Number(process.env.PORT ?? 4000)
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const distDir = path.resolve(__dirname, '../dist')

app.use(express.json())

app.get('/api/health', (_request, response) => {
  response.json({
    ok: true,
    service: 'KasiEats API',
    port,
  })
})

app.get('/api/zones', (_request, response) => {
  response.json(zones)
})

app.get('/api/stats', (_request, response) => {
  response.json(stats)
})

app.get('/api/vendors', (request, response) => {
  const zoneId = String(request.query.zoneId ?? '').trim().toLowerCase()
  const search = String(request.query.search ?? '').trim().toLowerCase()

  const results = vendors.filter((vendor) => {
    const matchesZone = zoneId ? vendor.zoneIds.includes(zoneId) : true

    if (!search) {
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

    return matchesZone && searchableText.includes(search)
  })

  response.json(results)
})

app.post('/api/orders', (request, response) => {
  const { customerName, phone, address, zoneId, items } = request.body ?? {}

  if (!customerName || !phone || !address || !Array.isArray(items) || items.length === 0) {
    response.status(400).json({
      message: 'Please provide customer details, delivery address, and at least one basket item.',
    })
    return
  }

  const vendorId = String(items[0]?.vendorId ?? '')
  const vendor = vendors.find((entry) => entry.id === vendorId)
  const zone = zones.find((entry) => entry.id === zoneId) ?? zones[0]

  const eta = zone.id === 'kwaggafontein' ? '28-36 min' : '22-30 min'
  const orderId = `KE-${Math.floor(1000 + Math.random() * 9000)}`

  response.status(201).json({
    orderId,
    eta,
    message: `Order ${orderId} is now with ${vendor?.name ?? 'the kitchen'} and waiting for rider assignment.`,
    trackingSteps: [
      `Basket confirmed for ${zone.name}`,
      'Closest rider accepted the route',
      'Customer will get a handoff call near arrival',
    ],
  })
})

app.use(express.static(distDir))

app.get(/^(?!\/api).*/, (_request, response) => {
  response.sendFile(path.join(distDir, 'index.html'))
})

app.listen(port, '0.0.0.0', () => {
  console.log(`KasiEats web app listening on http://0.0.0.0:${port}`)
})
