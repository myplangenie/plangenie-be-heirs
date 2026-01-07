// Check if running in production
const isProd = process.env.NODE_ENV === 'production' ||
               process.env.RAILWAY_ENVIRONMENT === 'production' ||
               process.env.VERCEL_ENV === 'production' ||
               process.env.RENDER === 'true';

// Cookie domain - only set if explicitly configured
// When using Next.js proxy, leave this unset so cookies default to the frontend domain
const cookieDomain = process.env.COOKIE_DOMAIN || undefined;

// SameSite setting:
// - 'lax' works for same-site (including through Next.js proxy)
// - 'none' required for true cross-origin (different domains)
const sameSiteValue = process.env.COOKIE_SAMESITE || 'lax';

// Log configuration on startup
console.log('[cookies] Configuration:', {
  isProd,
  cookieDomain: cookieDomain || '(not set - will use request domain)',
  sameSiteValue,
  nodeEnv: process.env.NODE_ENV
});

// Cookie configuration for access token
const ACCESS_TOKEN_COOKIE = {
  name: 'pg_access_token',
  options: {
    httpOnly: true,
    secure: isProd, // Required for sameSite: 'none'
    sameSite: sameSiteValue,
    path: '/',
    maxAge: 30 * 60 * 1000, // 30 minutes in milliseconds
    ...(cookieDomain ? { domain: cookieDomain } : {}),
  },
};

// Cookie configuration for refresh token
const REFRESH_TOKEN_COOKIE = {
  name: 'pg_refresh_token',
  options: {
    httpOnly: true,
    secure: isProd, // Required for sameSite: 'none'
    sameSite: sameSiteValue,
    path: '/', // Changed from '/api/auth' - some browsers have issues with path-restricted cookies
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days in milliseconds
    ...(cookieDomain ? { domain: cookieDomain } : {}),
  },
};

// Get clear cookie options (set maxAge to 0)
function clearCookieOptions(cookieConfig) {
  return {
    ...cookieConfig.options,
    maxAge: 0,
  };
}

module.exports = {
  ACCESS_TOKEN_COOKIE,
  REFRESH_TOKEN_COOKIE,
  clearCookieOptions,
  isProd,
};
