exports.generatePlan = async (req, res, next) => {
  try {
    const { answers } = req.body || {};
    const url = process.env.GAMMA_API_URL;
    const key = process.env.GAMMA_API_KEY;
    if (url && key) {
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify({ answers, userId: req.user?.id || undefined }),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) return res.status(resp.status).json({ ok: false, error: data?.message || 'Gamma error' });
      const link = data?.link || data?.url || data?.result?.link;
      return res.json({ ok: true, link });
    }
    // Fallback stub
    return res.json({ ok: true, link: `/downloads/generated-plan-${Date.now()}.html` });
  } catch (err) {
    return next(err);
  }
};

exports.generateMyPlan = async (req, res, next) => {
  try {
    const { doc } = req.body || {};
    const url = process.env.GAMMA_MY_PLAN_URL || process.env.GAMMA_API_URL;
    const key = process.env.GAMMA_API_KEY;
    if (url && key) {
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify({ doc, userId: req.user?.id || undefined }),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) return res.status(resp.status).json({ ok: false, error: data?.message || 'Gamma error' });
      const link = data?.link || data?.url || data?.result?.link;
      return res.json({ ok: true, link });
    }
    return res.json({ ok: true, link: `/downloads/my-plan-${Date.now()}.html` });
  } catch (err) {
    return next(err);
  }
};

