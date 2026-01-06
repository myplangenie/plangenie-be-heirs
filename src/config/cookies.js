const isProd = process.env.NODE_ENV === 'production';

// Cookie domain - set to allow sharing across subdomains in production
// e.g., COOKIE_DOMAIN=.plangenie.com (note the leading dot)
const cookieDomain = process.env.COOKIE_DOMAIN || undefined;

// For cross-origin setups (API on different subdomain), use 'none'
// For same-origin setups, use 'lax'
// 'strict' is too restrictive - breaks navigation from external links
const sameSiteValue = process.env.COOKIE_SAMESITE || (isProd ? 'none' : 'lax');

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
