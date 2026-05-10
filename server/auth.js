import { randomUUID } from 'node:crypto'
import jwt from 'jsonwebtoken'
import { config } from './config.js'
import { getAuthUserSnapshot } from './store.js'

const tokenTtls = {
  customer: config.customerTokenTtl,
  vendor: config.vendorTokenTtl,
  rider: config.riderTokenTtl,
  admin: config.adminTokenTtl,
}

function readBearerToken(request) {
  const header = request.headers.authorization ?? ''

  if (!header.startsWith('Bearer ')) {
    return null
  }

  return header.slice(7).trim()
}

export function issueToken(user, { tokenVersion = 1 } = {}) {
  return jwt.sign(
    {
      sub: user.id,
      role: user.role,
      ver: tokenVersion,
      sid: randomUUID(),
    },
    config.jwtSecret,
    {
      algorithm: 'HS256',
      audience: config.jwtAudience,
      issuer: config.jwtIssuer,
      expiresIn: tokenTtls[user.role] ?? config.customerTokenTtl,
    },
  )
}

export function authenticateOptional(request, response, next) {
  const token = readBearerToken(request)

  if (!token) {
    next()
    return
  }

  try {
    const decoded = jwt.verify(token, config.jwtSecret, {
      algorithms: ['HS256'],
      audience: config.jwtAudience,
      issuer: config.jwtIssuer,
    })
    const authUser = getAuthUserSnapshot(decoded.sub)

    if (
      !authUser ||
      authUser.user.role !== decoded.role ||
      authUser.tokenVersion !== Number(decoded.ver ?? 0) ||
      (authUser.lockedUntil && new Date(authUser.lockedUntil).getTime() > Date.now())
    ) {
      response.status(401).json({
        message: 'Session no longer matches the current account security state. Please sign in again.',
      })
      return
    }

    request.user = authUser.user
    request.auth = {
      expiresAt: typeof decoded.exp === 'number' ? decoded.exp * 1000 : null,
      issuedAt: typeof decoded.iat === 'number' ? decoded.iat * 1000 : null,
      sessionId: typeof decoded.sid === 'string' ? decoded.sid : null,
    }
    next()
  } catch (error) {
    response.status(401).json({
      message: error?.name === 'TokenExpiredError' ? 'Session expired. Please log in again.' : 'Invalid access token.',
    })
  }
}

export function requireAuth(request, response, next) {
  if (!request.user) {
    response.status(401).json({
      message: 'You must be signed in to use this route.',
    })
    return
  }

  next()
}

export function requireRole(...roles) {
  return (request, response, next) => {
    if (!request.user) {
      response.status(401).json({
        message: 'You must be signed in to use this route.',
      })
      return
    }

    if (!roles.includes(request.user.role)) {
      response.status(403).json({
        message: `Role ${request.user.role} is not allowed on this route.`,
      })
      return
    }

    next()
  }
}
