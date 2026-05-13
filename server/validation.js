import { z } from 'zod'

export const zoneIds = ['kwamhlanga', 'kwaggafontein']
export const operationalRoles = ['vendor', 'rider', 'admin']
export const orderStatuses = ['placed', 'accepted', 'preparing', 'ready', 'on-route', 'delivered']
export const pickupRequestStatuses = ['requested', 'accepted', 'collecting', 'on-route', 'delivered']
export const pushPlatforms = ['android', 'ios', 'web']

export const loginSchema = z.object({
  email: z.email().trim().toLowerCase(),
  password: z.string().min(8, 'Password must be at least 8 characters long.'),
})

export const registerCustomerSchema = z.object({
  name: z.string().trim().min(2).max(80),
  email: z.email().trim().toLowerCase(),
  phone: z.string().trim().min(8).max(24),
  password: z.string().min(8, 'Password must be at least 8 characters long.'),
  zoneId: z.enum(zoneIds),
})

export const adminCreateUserSchema = z.object({
  name: z.string().trim().min(2).max(80),
  email: z.email().trim().toLowerCase(),
  phone: z.string().trim().min(8).max(24),
  password: z.string().min(8, 'Password must be at least 8 characters long.'),
  role: z.enum(operationalRoles),
  vendorId: z.string().trim().min(1).max(80).optional(),
  zoneIds: z.array(z.enum(zoneIds)).max(zoneIds.length).optional().default([]),
})

export const orderSubmissionSchema = z.object({
  customerName: z.string().trim().min(2).max(80),
  phone: z.string().trim().min(8).max(24),
  address: z.string().trim().min(8).max(180),
  zoneId: z.enum(zoneIds),
  notes: z.string().trim().max(200).optional().default(''),
  paymentMethod: z.enum(['cash', 'card', 'ewallet']),
  successUrl: z.url().max(240).optional(),
  cancelUrl: z.url().max(240).optional(),
  items: z
    .array(
      z.object({
        vendorId: z.string().trim().min(1),
        menuItemId: z.string().trim().min(1),
        quantity: z.number().int().min(1).max(12),
      }),
    )
    .min(1)
    .max(12),
})

export const orderStatusSchema = z.object({
  status: z.enum(orderStatuses),
})

export const pickupRequestSubmissionSchema = z.object({
  customerName: z.string().trim().min(2).max(80),
  phone: z.string().trim().min(8).max(24),
  zoneId: z.enum(zoneIds),
  pickupAddress: z.string().trim().min(8).max(180),
  dropoffAddress: z.string().trim().min(8).max(180),
  itemDescription: z.string().trim().min(4).max(180),
  notes: z.string().trim().max(200).optional().default(''),
  paymentMethod: z.enum(['cash', 'ewallet']),
})

export const pickupRequestStatusSchema = z.object({
  status: z.enum(pickupRequestStatuses),
})

export const pushRegistrationSchema = z.object({
  token: z.string().trim().min(10).max(255),
  platform: z.enum(pushPlatforms),
})

export function parseWithSchema(schema, payload) {
  const result = schema.safeParse(payload)

  if (result.success) {
    return result.data
  }

  const issue = result.error.issues[0]
  const error = new Error(issue?.message ?? 'Validation failed.')
  error.statusCode = 400
  throw error
}
