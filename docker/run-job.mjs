// Runs one of Xtend's scheduled jobs from inside the container, for the
// scheduled tasks in Dokploy or Coolify (deploy/DOCKER.md):
//
//   node run-job.mjs alerts          every 5 minutes
//   node run-job.mjs absence-sweep   08:30 UTC daily
//   node run-job.mjs purge-selfies   02:20 UTC daily
//
// It calls the app on its own port with CRON_SECRET, so nothing is exposed
// and the image needs no curl. Exits non-zero on failure so the platform
// shows the run as failed.
const JOBS = new Set(['alerts', 'absence-sweep', 'purge-selfies', 'metrics'])
const job = process.argv[2]
if (!JOBS.has(job)) {
  console.error(`Which job? One of: ${[...JOBS].join(', ')}`)
  process.exit(2)
}
const secret = process.env.CRON_SECRET
if (!secret) {
  console.error('CRON_SECRET is not set in this container.')
  process.exit(1)
}
const port = process.env.PORT || 3000
try {
  const res = await fetch(`http://127.0.0.1:${port}/api/cron/${job}`, {
    headers: { Authorization: `Bearer ${secret}` },
    signal: AbortSignal.timeout(110_000),
  })
  const body = (await res.text()).slice(0, 300)
  console.log(`${new Date().toISOString()} ${job}: HTTP ${res.status} ${body}`)
  process.exit(res.ok ? 0 : 1)
} catch (error) {
  console.error(`${new Date().toISOString()} ${job}: ${error instanceof Error ? error.message : error}`)
  process.exit(1)
}
