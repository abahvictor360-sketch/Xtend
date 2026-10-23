/**
 * Checks the X Metrics feature switches (src/lib/metrics/features.ts,
 * migration 0063): which pages, tabs, menu items, dashboard parts, staff
 * app parts, downloads and Ask Xtend tools show for given switches.
 *
 *   npx tsx --tsconfig tsconfig.scripts.json scripts/check-xm-features.ts
 */
import {
  XM_ALL_ON,
  XM_FEATURE_INFO,
  XM_OFF_MESSAGE,
  XM_TABS,
  xmAssistantNote,
  xmAssistantToolOn,
  xmDashboardParts,
  xmExportColumnsOff,
  xmExportOn,
  xmFeatureChanges,
  xmFeaturesFrom,
  xmFieldTab,
  xmFieldView,
  xmKpiOn,
  xmMenuItem,
  xmOn,
  xmPageForPath,
  xmPageOn,
  xmTabs,
  type XmFeatures,
} from '@/lib/metrics/features'
import { dropColumns } from '@/lib/metrics/export'

let failed = 0
function check(ok: boolean, label: string, got?: unknown) {
  console.log(`${ok ? 'ok  ' : 'FAIL'}: ${label}${ok ? '' : ` (got ${JSON.stringify(got)})`}`)
  if (!ok) failed++
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
const tabs = (f: XmFeatures, readOnly = false) => xmTabs(f, readOnly).map((t) => t.label)
const off = (over: Partial<XmFeatures>): XmFeatures => ({ ...XM_ALL_ON, ...over })

// Reading the row.
check(same(xmFeaturesFrom(null), XM_ALL_ON), 'no settings row (or before 0063): everything on')
check(same(xmFeaturesFrom({ tolerance_pct: 5 }), XM_ALL_ON), 'a row without the switch columns: everything on')
check(
  same(xmFeaturesFrom({ enabled: true, expiry_enabled: false, supplies_enabled: true, grading_enabled: false, sales_enabled: true }),
    { enabled: true, expiry: false, supplies: true, grading: false, sales: true }),
  'the switch columns map to the switches',
)

// The parts, as xm_feature_on() decides them.
check(['xmetrics', 'expiry', 'supplies', 'grading', 'sales', 'reconcile'].every((p) => xmOn(XM_ALL_ON, p as never)), 'all on: every part on')
check(!xmOn(off({ enabled: false }), 'xmetrics') && !xmOn(off({ enabled: false }), 'sales') && !xmOn(off({ enabled: false }), 'expiry'),
  'X Metrics off: every part off, whatever its own switch says')
check(!xmOn(off({ supplies: false }), 'reconcile') && !xmOn(off({ sales: false }), 'reconcile') && xmOn(XM_ALL_ON, 'reconcile'),
  'reconciliation needs supplies and sales')
check(xmOn(off({ supplies: false, sales: false, expiry: false, grading: false }), 'xmetrics'), 'with every part off, stock counts stay')

// Pages and the sub-navigation.
check(same(tabs(XM_ALL_ON), XM_TABS.map((t) => t.label)), 'all on: every tab for an admin')
check(same(tabs(XM_ALL_ON, true), ['Overview', 'Expiry', 'Grades', 'Scoring policy']), 'supervisors see no admin-only tabs')
check(!tabs(off({ expiry: false })).includes('Expiry') && !xmPageOn(off({ expiry: false }), 'expiry'), 'expiry off: no Expiry tab or page')
check(!tabs(off({ supplies: false })).includes('Supplies') && !xmPageOn(off({ supplies: false }), 'supplies'), 'supplies off: no Supplies tab or page')
check(!tabs(off({ grading: false })).includes('Grades') && !tabs(off({ grading: false })).includes('Scoring policy')
  && !xmPageOn(off({ grading: false }), 'grades') && !xmPageOn(off({ grading: false }), 'policy'),
  'grading off: no Grades or Scoring policy tab or page')
check(!tabs(off({ sales: false })).includes('Targets') && !xmPageOn(off({ sales: false }), 'targets'), 'sales off: no Targets tab or page')
check(same(tabs(off({ enabled: false })), ['Settings']), 'X Metrics off: only Settings, so an admin can switch it back on', tabs(off({ enabled: false })))
check(same(tabs(off({ enabled: false }), true), []), 'X Metrics off: supervisors see no tabs')
check(xmPageOn(off({ enabled: false }), 'settings') && !xmPageOn(off({ enabled: false }), 'overview')
  && !xmPageOn(off({ enabled: false }), 'store') && !xmPageOn(off({ enabled: false }), 'staff') && !xmPageOn(off({ enabled: false }), 'setup'),
  'X Metrics off: every page but Settings is switched off')
check(xmPageOn(off({ expiry: false, supplies: false, grading: false, sales: false }), 'overview')
  && xmPageOn(off({ sales: false }), 'store') && xmPageOn(off({ grading: false }), 'staff'),
  'the overview, store and staff pages stay while X Metrics is on')
check(xmPageForPath('/admin/metrics') === 'overview' && xmPageForPath('/admin/metrics/expiry') === 'expiry'
  && xmPageForPath('/admin/metrics/stores/abc') === 'store' && xmPageForPath('/admin/metrics/staff/abc?month=2026-10') === 'staff'
  && xmPageForPath('/admin/metrics/settings') === 'settings' && xmPageForPath('/admin/attendance') === null
  && xmPageForPath('/admin/metrics/nope') === null,
  'addresses map to their pages')
check(XM_OFF_MESSAGE === 'This part of X Metrics is switched off. An admin can turn it on in X Metrics → Settings.',
  'a switched-off page says so and where to turn it on')

// The dashboard menu.
check(same(xmMenuItem(XM_ALL_ON, true), { show: true, href: '/admin/metrics', off: false })
  && same(xmMenuItem(XM_ALL_ON, false), { show: true, href: '/admin/metrics', off: false }), 'on: X Metrics in everyone\'s menu')
check(same(xmMenuItem(off({ enabled: false }), true), { show: true, href: '/admin/metrics/settings', off: true }),
  'off: admins keep it, marked off, opening Settings')
check(!xmMenuItem(off({ enabled: false }), false).show, 'off: gone from supervisors\' menus')
check(xmMenuItem(off({ sales: false, expiry: false }), false).show, 'a part off keeps X Metrics in the menu')

// The overview.
check(same(xmDashboardParts(XM_ALL_ON), { sales: true, supplies: true, reconcile: true, expiry: true, grading: true }), 'all on: every dashboard part')
check(same(xmDashboardParts(off({ sales: false })), { sales: false, supplies: true, reconcile: false, expiry: true, grading: true }),
  'sales off: no sales and no reconciliation on the dashboard')
const kpis = ['Units sold this month', 'Units supplied', 'Stock accuracy', 'Open expiry alerts']
check(kpis.every((k) => xmKpiOn(XM_ALL_ON, k)), 'all on: every KPI tile')
check(same(kpis.filter((k) => xmKpiOn(off({ supplies: false }), k)), ['Units sold this month', 'Open expiry alerts']),
  'supplies off: no supplied or accuracy tile')
check(same(kpis.filter((k) => xmKpiOn(off({ expiry: false, sales: false }), k)), ['Units supplied']), 'expiry and sales off: only the supplied tile')

// The staff app.
check(same(xmFieldView(XM_ALL_ON), { show: true, tabs: ['count', 'sales', 'score'], expiryInput: true, salesForm: true, score: true }),
  'all on: count, sales and score tabs, with the expiry date box')
check(same(xmFieldView(off({ sales: false })).tabs, ['count', 'score']) && !xmFieldView(off({ sales: false })).salesForm,
  'sales off: no sales form or tab')
check(!xmFieldView(off({ expiry: false })).expiryInput && same(xmFieldView(off({ expiry: false })).tabs, ['count', 'sales', 'score']),
  'expiry off: no expiry date box, the tabs stay')
check(same(xmFieldView(off({ grading: false })).tabs, ['count', 'sales']) && !xmFieldView(off({ grading: false })).score,
  'grading off: no score tab')
check(same(xmFieldView(off({ enabled: false })), { show: false, tabs: [], expiryInput: false, salesForm: false, score: false }),
  'X Metrics off: nothing in the staff app')
check(xmFieldTab(XM_ALL_ON, 'sales') === 'sales' && xmFieldTab(off({ sales: false }), 'sales') === 'count'
  && xmFieldTab(off({ grading: false }), 'score') === 'count' && xmFieldTab(XM_ALL_ON, null) === 'count',
  'a link to a switched-off tab opens the count instead')
const staffWords = XM_FEATURE_INFO.map((i) => i.line).join(' ').toLowerCase()
check(!/location|gps|track|monitor|integrity/.test(staffWords), 'the switch descriptions say nothing about monitoring')

// Downloads.
check(['grades', 'stock', 'discrepancies', 'supplies'].every((k) => xmExportOn(XM_ALL_ON, k)) && !xmExportOn(XM_ALL_ON, 'nope'),
  'all on: every download')
check(!xmExportOn(off({ grading: false }), 'grades') && !xmExportOn(off({ supplies: false }), 'supplies')
  && !xmExportOn(off({ sales: false }), 'discrepancies') && xmExportOn(off({ sales: false }), 'stock'),
  'each download goes with its part; stock stays')
check(['grades', 'stock', 'discrepancies', 'supplies'].every((k) => !xmExportOn(off({ enabled: false }), k)), 'X Metrics off: no downloads')
check(same(xmExportColumnsOff(XM_ALL_ON, 'grades'), []) && same(xmExportColumnsOff(XM_ALL_ON, 'stock'), []), 'all on: no columns left out')
check(same(xmExportColumnsOff(off({ expiry: false }), 'stock'), ['Expiry', 'Time left'])
  && same(xmExportColumnsOff(off({ sales: false, expiry: false }), 'grades'), ['Sales', 'Sold / target', 'Accuracy', 'Expiry']),
  'switched-off parts leave their columns out')
const sheet = {
  title: 't', subtitle: 's', sheetName: 'S', fileBase: 'f',
  columns: ['Store', 'Expiry', 'Time left', 'Total'],
  rows: [{ values: ['Ikeja', '2027-01-01', '70 days', '5'] }],
  widths: { xlsx: [20, 12, 10, 8], pdf: [100, 60, 50, 40] },
}
const dropped = dropColumns(sheet, ['Expiry', 'Time left'])
check(same(dropped.columns, ['Store', 'Total']) && same(dropped.rows[0].values, ['Ikeja', '5'])
  && same(dropped.widths, { xlsx: [20, 8], pdf: [100, 40] }), 'a left-out column takes its values and widths with it')
check(dropColumns(sheet, []) === sheet, 'nothing left out: the sheet is unchanged')

// Ask Xtend.
check(['x_metrics', 'propose_xmetrics_store', 'propose_sales_target', 'attendance_on_day'].every((t) => xmAssistantToolOn(XM_ALL_ON, t)),
  'all on: every tool')
check(!xmAssistantToolOn(off({ sales: false }), 'propose_sales_target') && xmAssistantToolOn(off({ sales: false }), 'x_metrics'),
  'sales off: no sales targets from Ask Xtend')
check(!xmAssistantToolOn(off({ enabled: false }), 'x_metrics') && !xmAssistantToolOn(off({ enabled: false }), 'propose_xmetrics_store')
  && xmAssistantToolOn(off({ enabled: false }), 'attendance_on_day'), 'X Metrics off: no X Metrics tools; the rest stay')
check(xmAssistantNote(XM_ALL_ON) === null, 'all on: nothing to tell Ask Xtend')
check((xmAssistantNote(off({ sales: false, expiry: false })) ?? '').includes('expiry, sales are switched off'),
  'parts off: Ask Xtend is told which', xmAssistantNote(off({ sales: false, expiry: false })))
check((xmAssistantNote(off({ enabled: false })) ?? '').startsWith('X Metrics is switched off'), 'X Metrics off: Ask Xtend is told')

// The audit line.
check(same(xmFeatureChanges(XM_ALL_ON, off({ sales: false, expiry: false })), ['Expiry off', 'Sales off']), 'the audit says what was switched')
check(same(xmFeatureChanges(off({ enabled: false }), XM_ALL_ON), ['X Metrics on']), 'and what came back on')

if (failed) {
  console.log(`\n${failed} check(s) FAILED`)
  process.exit(1)
}
console.log('\nALL X METRICS FEATURE CHECKS PASSED')
