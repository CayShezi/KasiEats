import { z } from 'zod'

export const zoneIds = ['kwamhlanga', 'kwaggafontein']
export const orderStatuses = ['placed', 'accepted', 'preparing', 'ready', 'on-route', 'delivered']
export const pushPlatforms = ['android', 'ios', 'web']

export const loginSchema = z.object({
  email: z.email().trim().toLowerCase(),
  password: z.string().min(8, 'Password must be at least 8 characters long.'),
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
