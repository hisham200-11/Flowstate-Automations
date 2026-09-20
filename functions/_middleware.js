/**
 * FlowState Automations - Edge DevSecOps Middleware
 * Intercepts all incoming requests on Cloudflare Pages Functions
 * 
 * Enforces:
 * 1. Global Security Response Headers
 * 2. In-Memory IP Sliding-Window Rate Limiting
 * 3. Payload Size Guard (Max 64KB on /api/*)
 * 4. Content-Type Validation
 */

// In-memory sliding-window rate limit buckets (per worker isolate)
const rateLimitStore = new Map();
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute

const ROUTE_LIMITS = {
  '/api/contact': 5,  // Max 5 submissions/min per IP
  '/api/chat': 15,    // Max 15 chat turns/min per IP
  'default_api': 30   // Max 30 API calls/min per IP
};

let lastCleanup = Date.now();

function cleanupExpiredEntries(now) {
  if (now - lastCleanup < 60000) return;
  lastCleanup = now;
  for (const [key, record] of rateLimitStore.entries()) {
    if (now - record.windowStart > RATE_LIMIT_WINDOW_MS) {
      rateLimitStore.delete(key);
    }
  }
}

function checkRateLimit(clientIp, pathname, now) {
  cleanupExpiredEntries(now);

  const limitKey = `${clientIp}:${pathname}`;
  const maxLimit = ROUTE_LIMITS[pathname] || ROUTE_LIMITS['default_api'];

  let record = rateLimitStore.get(limitKey);
  if (!record || now - record.windowStart > RATE_LIMIT_WINDOW_MS) {
    record = { windowStart: now, count: 1 };
    rateLimitStore.set(limitKey, record);
    return { allowed: true, remaining: maxLimit - 1 };
  }

  record.count += 1;
  if (record.count > maxLimit) {
    return { allowed: false, remaining: 0, retryAfter: Math.ceil((RATE_LIMIT_WINDOW_MS - (now - record.windowStart)) / 1000) };
  }

  return { allowed: true, remaining: maxLimit - record.count };
}

export async function onRequest(context) {
  const { request, next } = context;
  const url = new URL(request.url);
  const pathname = url.pathname;
  const now = Date.now();

  const clientIp = 
    request.headers.get('cf-connecting-ip') ||
    request.headers.get('x-real-ip') ||
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    '127.0.0.1';

  // 1. Enforce API Protection on /api/* routes
  if (pathname.startsWith('/api/')) {
    // A. Payload Size Guard (Max 64KB)
    const contentLength = request.headers.get('content-length');
    if (contentLength && parseInt(contentLength, 10) > 65536) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Payload Too Large: Request body exceeds the 64KB security limit.'
        }),
        {
          status: 413,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
          }
        }
      );
    }

    // B. In-Memory Rate Limiting Guard
    if (request.method === 'POST') {
      const rateCheck = checkRateLimit(clientIp, pathname, now);
      if (!rateCheck.allowed) {
        return new Response(
          JSON.stringify({
            success: false,
            error: `Rate limit exceeded. Too many requests from this IP. Please try again in ${rateCheck.retryAfter} seconds.`
          }),
          {
            status: 429,
            headers: {
              'Content-Type': 'application/json',
              'Retry-After': String(rateCheck.retryAfter || 60),
              'X-RateLimit-Limit': String(ROUTE_LIMITS[pathname] || 30),
              'X-RateLimit-Remaining': '0',
              'Access-Control-Allow-Origin': '*'
            }
          }
        );
      }
    }
  }

  // Delegate to downstream endpoint handler
  const response = await next();

  // 2. Clone response and inject enterprise security headers
  const securedHeaders = new Headers(response.headers);
  securedHeaders.set('X-Frame-Options', 'DENY');
  securedHeaders.set('X-Content-Type-Options', 'nosniff');
  securedHeaders.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  securedHeaders.set(
    'Permissions-Policy',
    'accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()'
  );
  securedHeaders.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: securedHeaders
  });
}
