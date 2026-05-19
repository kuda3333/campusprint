// GET /api/health — used by uptime monitors (UptimeRobot, Better Uptime, etc.)
// Returns 200 + JSON when the function cold-starts successfully.
// Wire your monitor to alert on non-200 or latency > 5s.
module.exports = function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({
    status: 'ok',
    ts: new Date().toISOString(),
    version: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) || 'dev',
    region: process.env.VERCEL_REGION || 'unknown',
  });
};
