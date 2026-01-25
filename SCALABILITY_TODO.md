# Scalability Improvements TODO

> Generated: 2026-01-25
> Target: Support 1000-2000 concurrent users

## Current Capacity: ~200 concurrent users

---

## Phase 1: Quick Wins (Week 1)

### 1. Add Rate Limiting
```bash
npm install express-rate-limit
```
```javascript
// app.js
const rateLimit = require('express-rate-limit');
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // 100 requests per window
  message: 'Too many requests'
});
app.use('/api/', limiter);
```

### 2. Add Request Timeout
```javascript
// app.js
app.use((req, res, next) => {
  req.setTimeout(30000); // 30 seconds
  next();
});
```

### 3. Increase MongoDB Connection Pool
```javascript
// wherever mongoose.connect is called
mongoose.connect(uri, {
  maxPoolSize: 50,      // Default is 10
  minPoolSize: 10,
  maxIdleTimeMS: 60000,
});
```

### 4. Add TTL Index to AgentCache
```javascript
// Run once or add to migration
AgentCache.collection.createIndex(
  { createdAt: 1 },
  { expireAfterSeconds: 7200 } // 2 hours
);
AgentCache.collection.createIndex({ user: 1, agentType: 1, workspace: 1 });
```

### 5. Add Missing Indexes
```javascript
DailyWish.collection.createIndex({ user: 1, workspace: 1, wishDate: 1 });
```

### 6. Add Compression
```bash
npm install compression
```
```javascript
// app.js
const compression = require('compression');
app.use(compression());
```

---

## Phase 2: Short-term (Weeks 2-3)

### 1. Replace node-cron with Bull Queue
```bash
npm install bull
```
- Prevents overlapping jobs
- Job retries built-in
- Persistent queue

### 2. Add Redis for Caching
```bash
npm install ioredis
```
- Replace MongoDB AgentCache with Redis
- Sub-millisecond lookups
- Automatic TTL expiration

### 3. Paginate buildAgentContext()
```javascript
// src/agents/base.js - limit large collections
CoreProject.find(crudFilter).sort({ order: 1 }).limit(50).lean()
DepartmentProject.find(crudFilter).sort({ order: 1 }).limit(50).lean()
```

### 4. Queue OpenAI API Calls
- Max 5 concurrent calls
- Exponential backoff on failures
- Token counting before requests

### 5. Fix O(n²) Scoring
```javascript
// services/scoringService.js
// Replace loop-based blocker detection with indexed query
const laterItemsCount = await Model.countDocuments({
  dueWhen: { $gt: itemDue }
});
```

---

## Phase 3: Medium-term (Month 1)

- [ ] Separate read replicas for expensive queries
- [ ] Implement circuit breaker for external APIs
- [ ] Add monitoring/alerting (e.g., Datadog, New Relic)
- [ ] Load testing with 1000+ simulated users
- [ ] Database query optimization audit

---

## Biggest Offenders (Fix First)

1. **recalculatePriorities job** - Runs hourly with O(n²) for all users
2. **buildAgentContext()** - 12 DB queries, fetches everything
3. **No rate limiting** - Vulnerable to DOS
4. **dailyWish job** - 12 queries + 1 OpenAI call per user

---

## Risk Matrix

| Area | Risk | Impact at 1000 users |
|------|------|---------------------|
| No rate limiting | CRITICAL | DOS vulnerable |
| Hourly recalc | CRITICAL | CPU spike, timeouts |
| OpenAI no queue | HIGH | Rate limit errors |
| MongoDB pool (10) | HIGH | Connection exhaustion |
| O(n²) scoring | MEDIUM | Slow responses |

---

## Estimated Timeline

- Phase 1: 1-2 weeks
- Phase 2: 2-3 weeks
- Production-ready for 1000 users: ~6 weeks total
