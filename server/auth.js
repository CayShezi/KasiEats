import jwt from 'jsonwebtoken'
import { config } from './config.js'
import { getUserById } from './store.js'

function readBearerToken(request) {
  const header = request.headers.authorization ?? ''

  if (!header.startsWith('Bearer ')) {
    return null
  }

  return header.slice(7).trim()
}

export function issueToken(user) {
  return jwt.sign(
    {
      sub: user.id,
      role: user.role,
    },
    config.jwtSecret,
    {
      expiresIn: '8h',
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
    const decoded = jwt.verify(token, config.jwtSecret)
    const user = getUserById(decoded.sub)

    if (!user) {
      response.status(401).json({
        message: 'Session expired. Please log in again.',
      })
      return
    }

    request.user = user
    next()
  } catch {
    response.status(401).json({
      message: 'Invalid access token.',
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
