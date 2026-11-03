import type { MetadataRoute } from 'next'

/**
 * Xtend is a private staff app: no search engine or AI crawler may index
 * any of it, the download page included (staff get that link from their
 * admin). The middleware also refuses known bots outright (lib/bot-guard.ts).
 */
export default function robots(): MetadataRoute.Robots {
  return { rules: [{ userAgent: '*', disallow: '/' }] }
}
