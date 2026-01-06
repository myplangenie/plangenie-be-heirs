const isProd = process.env.NODE_ENV === 'production';

// Cookie configuration for access token
const ACCESS_TOKEN_COOKIE = {
  name: 'pg_access_token',
  options: {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? 'strict' : 'lax',
    path: '/',
    maxAge: 30 * 60 * 1000, // 30 minutes in milliseconds
  },
};

// Cookie configuration for refresh token
const REFRESH_TOKEN_COOKIE = {
  name: 'pg_refresh_token',
  options: {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? 'strict' : 'lax',
    path: '/api/auth', // Only sent to auth endpoints
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days in milliseconds
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
