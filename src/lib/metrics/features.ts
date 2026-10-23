/**
 * X Metrics feature switches (migration 0063): which parts of X Metrics
 * are on. Pure, so the browser, the server and the check script share it.
 * The database enforces the same rules (xm_feature_on); this decides what
 * is shown.
 *
 *   enabled   the whole module: stores, products, stock counts
 *   expiry    expiry dates on counts, expiry alerts, the Expiry page
 *   supplies  stock supplied: the Supplies page and its imports
 *   grading   monthly grades, the Grades and Scoring policy pages, staff scores
 *   sales     units sold: the staff sales form, targets, sales figures
 *
 * Reconciliation (last count + supplied − sold) needs supplies and sales.
 * With the module off, every part is off whatever its own switch says.
 */

export type XmFeatureKey = 'expiry' | 'supplies' | 'grading' | 'sales'

export interface XmFeatures {
  enabled: boolean
  expiry: boolean
  supplies: boolean
  grading: boolean
  sales: boolean
}

/** A part of X Metrics that can be on or off. */
export type XmPart = 'xmetrics' | XmFeatureKey | 'reconcile'

export const XM_ALL_ON: XmFeatures = { enabled: true, expiry: true, supplies: true, grading: true, sales: true }

export const XM_OFF_MESSAGE = 'This part of X Metrics is switched off. An admin can turn it on in X Metrics → Settings.'

/** What each switch controls, in the words the Settings page uses. */
export const XM_FEATURE_INFO: { key: keyof XmFeatures; label: string; line: string }[] = [
  {
    key: 'enabled',
    label: 'X Metrics',
    line: 'The whole module: stock counts by batch, stores and products. Off hides X Metrics from the menu and the staff app.',
  },
  {
    key: 'expiry',
    label: 'Expiry',
    line: 'Expiry dates on stock counts, expiry alerts, the Expiry page and expiry in grades.',
  },
  {
    key: 'supplies',
    label: 'Supplies',
    line: 'Stock supplied to stores: the Supplies page, invoice imports, and checking counts against what was supplied.',
  },
  {
    key: 'grading',
    label: 'Grading',
    line: 'Monthly grades, the Grades and Scoring policy pages, and the score staff see.',
  },
  {
    key: 'sales',
    label: 'Sales',
    line: 'Units sold: the daily sales form for staff, month-end sales, sales against target and the Targets page.',
  },
]

/**
 * The switches from an xm_settings row. A column that is missing (0063
 * not run yet) or unreadable counts as on, which is how X Metrics worked
 * before the switches existed.
 */
export function xmFeaturesFrom(row: Record<string, unknown> | null | undefined): XmFeatures {
  const on = (k: string) => (row && typeof row[k] === 'boolean' ? (row[k] as boolean) : true)
  return {
    enabled: on('enabled'),
    expiry: on('expiry_enabled'),
    supplies: on('supplies_enabled'),
    grading: on('grading_enabled'),
    sales: on('sales_enabled'),
  }
}

/** Whether a part is on now, the same rule as xm_feature_on() in SQL. */
export function xmOn(f: XmFeatures, part: XmPart): boolean {
  if (!f.enabled) return false
  switch (part) {
    case 'xmetrics':
      return true
    case 'reconcile':
      return f.supplies && f.sales
    default:
      return f[part]
  }
}

/** Dashboard pages under /admin/metrics. */
export type XmPage =
  | 'overview'
  | 'expiry'
  | 'grades'
  | 'policy'
  | 'supplies'
  | 'targets'
  | 'setup'
  | 'settings'
  | 'store'
  | 'staff'

const PAGE_NEEDS: Record<XmPage, XmPart | null> = {
  overview: 'xmetrics',
  expiry: 'expiry',
  grades: 'grading',
  policy: 'grading',
  supplies: 'supplies',
  targets: 'sales',
  setup: 'xmetrics',
  // Always reachable by admins, so X Metrics can be switched back on.
  settings: null,
  store: 'xmetrics',
  staff: 'xmetrics',
}

export function xmPageOn(f: XmFeatures, page: XmPage): boolean {
  const need = PAGE_NEEDS[page]
  return need === null || xmOn(f, need)
}

/** The page a dashboard address is, or null when it is not X Metrics. */
export function xmPageForPath(pathname: string): XmPage | null {
  const m = /^\/admin\/metrics(?:\/([^/?#]+))?/.exec(pathname)
  if (!m) return null
  if (!m[1]) return 'overview'
  const seg = m[1]
  if (seg === 'stores') return 'store'
  if (seg === 'staff') return 'staff'
  return seg in PAGE_NEEDS ? (seg as XmPage) : null
}

export interface XmTab {
  href: string
  label: string
  page: XmPage
  adminOnly?: boolean
}

export const XM_TABS: XmTab[] = [
  { href: '/admin/metrics', label: 'Overview', page: 'overview' },
  { href: '/admin/metrics/expiry', label: 'Expiry', page: 'expiry' },
  { href: '/admin/metrics/grades', label: 'Grades', page: 'grades' },
  { href: '/admin/metrics/policy', label: 'Scoring policy', page: 'policy' },
  { href: '/admin/metrics/supplies', label: 'Supplies', page: 'supplies', adminOnly: true },
  { href: '/admin/metrics/targets', label: 'Targets', page: 'targets', adminOnly: true },
  { href: '/admin/metrics/setup', label: 'Products & stores', page: 'setup', adminOnly: true },
  { href: '/admin/metrics/settings', label: 'Settings', page: 'settings', adminOnly: true },
]

/** The X Metrics sub-navigation a person sees with these switches. */
export function xmTabs(f: XmFeatures, readOnly: boolean): XmTab[] {
  return XM_TABS.filter((t) => (!readOnly || !t.adminOnly) && xmPageOn(f, t.page))
}

/**
 * The X Metrics item in the dashboard menu. With the module off it goes
 * from supervisors' menus; admins keep it, marked Off, opening Settings
 * so they can switch it back on.
 */
export function xmMenuItem(f: XmFeatures, isAdmin: boolean): { show: boolean; href: string; off: boolean } {
  if (f.enabled) return { show: true, href: '/admin/metrics', off: false }
  return isAdmin ? { show: true, href: '/admin/metrics/settings', off: true } : { show: false, href: '/admin/metrics', off: true }
}

/** Which parts of the X Metrics overview are shown. */
export function xmDashboardParts(f: XmFeatures) {
  return {
    sales: xmOn(f, 'sales'),
    supplies: xmOn(f, 'supplies'),
    reconcile: xmOn(f, 'reconcile'),
    expiry: xmOn(f, 'expiry'),
    grading: xmOn(f, 'grading'),
  }
}

/** Which KPI tiles show, by label (see loadXmDashboard). */
export function xmKpiOn(f: XmFeatures, label: string): boolean {
  if (label === 'Units sold this month') return xmOn(f, 'sales')
  if (label === 'Units supplied') return xmOn(f, 'supplies')
  if (label === 'Stock accuracy') return xmOn(f, 'reconcile')
  if (label === 'Open expiry alerts') return xmOn(f, 'expiry')
  return xmOn(f, 'xmetrics')
}

export type XmFieldTab = 'count' | 'sales' | 'score'

/** What the staff app shows of X Metrics. Staff are never told why. */
export function xmFieldView(f: XmFeatures) {
  const show = xmOn(f, 'xmetrics')
  const tabs: XmFieldTab[] = show
    ? (['count', ...(xmOn(f, 'sales') ? ['sales'] : []), ...(xmOn(f, 'grading') ? ['score'] : [])] as XmFieldTab[])
    : []
  return { show, tabs, expiryInput: xmOn(f, 'expiry'), salesForm: xmOn(f, 'sales'), score: xmOn(f, 'grading') }
}

/** The tab a staff member lands on: the one asked for if it is shown. */
export function xmFieldTab(f: XmFeatures, asked: string | null | undefined): XmFieldTab {
  const { tabs } = xmFieldView(f)
  return tabs.includes(asked as XmFieldTab) ? (asked as XmFieldTab) : 'count'
}

/** Which X Metrics downloads are offered. */
export function xmExportOn(f: XmFeatures, kind: string): boolean {
  switch (kind) {
    case 'grades':
      return xmOn(f, 'grading')
    case 'stock':
      return xmOn(f, 'xmetrics')
    case 'discrepancies':
      return xmOn(f, 'reconcile')
    case 'supplies':
      return xmOn(f, 'supplies')
    default:
      return false
  }
}

/** Columns a download leaves out because their part is switched off. */
export function xmExportColumnsOff(f: XmFeatures, kind: string): string[] {
  const off: string[] = []
  if (kind === 'grades') {
    if (!xmOn(f, 'sales')) off.push('Sales', 'Sold / target')
    if (!xmOn(f, 'reconcile')) off.push('Accuracy')
    if (!xmOn(f, 'expiry')) off.push('Expiry')
  }
  if ((kind === 'stock' || kind === 'supplies') && !xmOn(f, 'expiry')) off.push('Expiry', 'Time left')
  return off
}

/** Ask Xtend tools that belong to a part of X Metrics. */
const ASSISTANT_TOOL_NEEDS: Record<string, XmPart> = {
  x_metrics: 'xmetrics',
  propose_xmetrics_store: 'xmetrics',
  propose_sales_target: 'sales',
}

/** Whether Ask Xtend is given a tool with these switches. */
export function xmAssistantToolOn(f: XmFeatures, tool: string): boolean {
  const need = ASSISTANT_TOOL_NEEDS[tool]
  return need === undefined || xmOn(f, need)
}

/** A line telling Ask Xtend what is switched off, or null when all is on. */
export function xmAssistantNote(f: XmFeatures): string | null {
  if (!f.enabled) return 'X Metrics is switched off: say so if asked about it, and that an admin can turn it on in X Metrics → Settings.'
  const off = XM_FEATURE_INFO.filter((i) => i.key !== 'enabled' && !f[i.key as XmFeatureKey]).map((i) => i.label.toLowerCase())
  if (!off.length) return null
  return `In X Metrics, ${off.join(', ')} ${off.length === 1 ? 'is' : 'are'} switched off: leave ${off.length === 1 ? 'it' : 'them'} out, and say so if asked.`
}

/** What a change of switches says in the audit log: "Sales off, Expiry on". */
export function xmFeatureChanges(before: XmFeatures, after: XmFeatures): string[] {
  return XM_FEATURE_INFO.filter((i) => before[i.key] !== after[i.key]).map((i) => `${i.label} ${after[i.key] ? 'on' : 'off'}`)
}
