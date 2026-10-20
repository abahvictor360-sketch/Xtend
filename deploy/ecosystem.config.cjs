/**
 * PM2 process file for Xtend on a VPS (deploy/README.md).
 *
 * One Next.js process per CPU core in cluster mode, all sharing port 3000
 * behind Nginx, so every core takes part in the 08:00 clock-in rush. PM2
 * restarts a process that crashes or grows past the memory cap, and
 * `pm2 reload` swaps them one at a time on each deploy without dropping
 * requests. `cwd` is the `current` symlink, which deploy.sh points at the
 * newest release before reloading.
 */
const APP_DIR = process.env.XTEND_APP_DIR || '/var/www/xtend'

module.exports = {
  apps: [
    {
      name: 'xtend',
      cwd: `${APP_DIR}/current`,
      script: 'node_modules/next/dist/bin/next',
      args: 'start -p 3000 -H 127.0.0.1',
      exec_mode: 'cluster',
      instances: process.env.XTEND_INSTANCES || 'max',
      max_memory_restart: process.env.XTEND_MAX_MEMORY || '1500M',
      kill_timeout: 10000,
      listen_timeout: 20000,
      env: {
        NODE_ENV: 'production',
        TRUSTED_PROXY_HOPS: process.env.TRUSTED_PROXY_HOPS || '1',
      },
      out_file: `${APP_DIR}/shared/logs/xtend-out.log`,
      error_file: `${APP_DIR}/shared/logs/xtend-error.log`,
      merge_logs: true,
      time: true,
    },
  ],
}
