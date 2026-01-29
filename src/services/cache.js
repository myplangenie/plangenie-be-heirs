/**
 * Redis Cache Service
 *
 * Provides caching utilities using ioredis.
 * Falls back gracefully if Redis is unavailable.
 */

const Redis = require('ioredis');

// Create Redis client (lazy initialization)
let redis = null;
let redisReady = false;

function getRedisClient() {
  if (redis) return redis;

  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    console.warn('[cache] REDIS_URL not configured - caching disabled');
    return null;
  }

  try {
    redis = new Redis(redisUrl, {
      maxRetriesPerRequest: 3,
      retryDelayOnFailover: 100,
      enableReadyCheck: true,
      lazyConnect: true,
    });

    redis.on('connect', () => {
      console.log('[cache] Redis connected');
    });

    redis.on('ready', () => {
      redisReady = true;
      console.log('[cache] Redis ready');
    });

    redis.on('error', (err) => {
      console.error('[cache] Redis error:', err.message);
      redisReady = false;
    });

    redis.on('close', () => {
      redisReady = false;
      console.log('[cache] Redis connection closed');
    });

    // Connect
    redis.connect().catch((err) => {
      console.error('[cache] Redis connection failed:', err.message);
    });

    return redis;
  } catch (err) {
    console.error('[cache] Failed to create Redis client:', err.message);
    return null;
  }
}

// Initialize on module load
getRedisClient();

// ============================================
// Cache Key Generators
// ============================================

const CACHE_KEYS = {
  // User-specific keys
  userBootstrap: (userId, workspaceId) => `bootstrap:${userId}:${workspaceId || 'default'}`,
  userCoreProjects: (userId, workspaceId) => `core-projects:${userId}:${workspaceId || 'default'}`,
  userDeptProjects: (userId, workspaceId) => `dept-projects:${userId}:${workspaceId || 'default'}`,
  userWorkspaces: (userId) => `workspaces:${userId}`,
  userTourStatus: (userId) => `tour-status:${userId}`,
  userNotificationIds: (userId) => `notification-ids:${userId}`,

  // Collab keys
  collabViewables: (userId) => `collab-viewables:${userId}`,

  // Patterns for invalidation
  patterns: {
    userAll: (userId) => `*:${userId}:*`,
    workspaceAll: (userId, workspaceId) => `*:${userId}:${workspaceId}`,
  },
};

// Default TTLs in seconds
const TTL = {
  SHORT: 60,           // 1 minute
  MEDIUM: 5 * 60,      // 5 minutes
  LONG: 15 * 60,       // 15 minutes
  VERY_LONG: 60 * 60,  // 1 hour
};

// ============================================
// Cache Operations
// ============================================

/**
 * Get a value from cache
 * @param {string} key - Cache key
 * @returns {Promise<any|null>} - Parsed value or null
 */
async function get(key) {
  if (!redis || !redisReady) return null;

  try {
    const value = await redis.get(key);
    if (!value) return null;
    return JSON.parse(value);
  } catch (err) {
    console.error('[cache] Get error:', err.message);
    return null;
  }
}

/**
 * Set a value in cache
 * @param {string} key - Cache key
 * @param {any} value - Value to cache (will be JSON stringified)
 * @param {number} ttl - TTL in seconds (default: 5 minutes)
 * @returns {Promise<boolean>} - Success status
 */
async function set(key, value, ttl = TTL.MEDIUM) {
  if (!redis || !redisReady) return false;

  try {
    await redis.set(key, JSON.stringify(value), 'EX', ttl);
    return true;
  } catch (err) {
    console.error('[cache] Set error:', err.message);
    return false;
  }
}

/**
 * Delete a specific key from cache
 * @param {string} key - Cache key
 * @returns {Promise<boolean>} - Success status
 */
async function del(key) {
  if (!redis || !redisReady) return false;

  try {
    await redis.del(key);
    return true;
  } catch (err) {
    console.error('[cache] Del error:', err.message);
    return false;
  }
}

/**
 * Delete multiple keys matching a pattern
 * @param {string} pattern - Key pattern (e.g., "core-projects:userId:*")
 * @returns {Promise<number>} - Number of keys deleted
 */
async function delPattern(pattern) {
  if (!redis || !redisReady) return 0;

  try {
    const keys = await redis.keys(pattern);
    if (keys.length === 0) return 0;

    const deleted = await redis.del(...keys);
    return deleted;
  } catch (err) {
    console.error('[cache] DelPattern error:', err.message);
    return 0;
  }
}

// ============================================
// Cache Invalidation Helpers
// ============================================

/**
 * Invalidate all caches for a user's workspace
 */
async function invalidateUserWorkspace(userId, workspaceId) {
  if (!redis || !redisReady) return;

  const keys = [
    CACHE_KEYS.userBootstrap(userId, workspaceId),
    CACHE_KEYS.userCoreProjects(userId, workspaceId),
    CACHE_KEYS.userDeptProjects(userId, workspaceId),
  ];

  try {
    await redis.del(...keys);
  } catch (err) {
    console.error('[cache] InvalidateUserWorkspace error:', err.message);
  }
}

/**
 * Invalidate core projects cache for a user
 */
async function invalidateCoreProjects(userId, workspaceId) {
  await del(CACHE_KEYS.userCoreProjects(userId, workspaceId));
  await del(CACHE_KEYS.userBootstrap(userId, workspaceId));
}

/**
 * Invalidate department projects cache for a user
 */
async function invalidateDeptProjects(userId, workspaceId) {
  await del(CACHE_KEYS.userDeptProjects(userId, workspaceId));
  await del(CACHE_KEYS.userBootstrap(userId, workspaceId));
}

/**
 * Invalidate workspaces cache for a user
 */
async function invalidateWorkspaces(userId) {
  await del(CACHE_KEYS.userWorkspaces(userId));
  // Also invalidate bootstrap for all workspaces
  await delPattern(`bootstrap:${userId}:*`);
}

/**
 * Invalidate tour status cache for a user
 */
async function invalidateTourStatus(userId) {
  await del(CACHE_KEYS.userTourStatus(userId));
  await delPattern(`bootstrap:${userId}:*`);
}

/**
 * Invalidate notification IDs cache for a user
 */
async function invalidateNotificationIds(userId) {
  await del(CACHE_KEYS.userNotificationIds(userId));
  await delPattern(`bootstrap:${userId}:*`);
}

/**
 * Invalidate collab viewables cache for a user
 */
async function invalidateCollabViewables(userId) {
  await del(CACHE_KEYS.collabViewables(userId));
  await delPattern(`bootstrap:${userId}:*`);
}

// ============================================
// Cache-Aside Pattern Helper
// ============================================

/**
 * Get from cache or fetch and cache
 * @param {string} key - Cache key
 * @param {Function} fetchFn - Async function to fetch data if not cached
 * @param {number} ttl - TTL in seconds
 * @returns {Promise<any>} - Cached or fetched data
 */
async function getOrSet(key, fetchFn, ttl = TTL.MEDIUM) {
  // Try cache first
  const cached = await get(key);
  if (cached !== null) {
    return cached;
  }

  // Fetch fresh data
  const data = await fetchFn();

  // Cache for next time (don't await - fire and forget)
  set(key, data, ttl).catch(() => {});

  return data;
}

// ============================================
// Health Check
// ============================================

async function isHealthy() {
  if (!redis || !redisReady) return false;

  try {
    const pong = await redis.ping();
    return pong === 'PONG';
  } catch {
    return false;
  }
}

module.exports = {
  // Core operations
  get,
  set,
  del,
  delPattern,
  getOrSet,

  // Key generators
  CACHE_KEYS,
  TTL,

  // Invalidation helpers
  invalidateUserWorkspace,
  invalidateCoreProjects,
  invalidateDeptProjects,
  invalidateWorkspaces,
  invalidateTourStatus,
  invalidateNotificationIds,
  invalidateCollabViewables,

  // Health
  isHealthy,

  // Direct client access (use sparingly)
  getClient: () => redis,
};
