import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { TextRun as DocxRun } from 'docx'

/**
 * Keeps a temporary password for the staff login sheet (migration 041)
 * until the person chooses their own. Called with the service-role client
 * wherever a temporary password is made: a new account, a bulk import, a
 * reset. A failure here never stops the account being created; the
 * password is still shown to whoever made it.
 */
export async function rememberTempPassword(admin: SupabaseClient, userId: string, password: string) {
  try {
    await admin
      .from('staff_temp_passwords')
      .upsert({ user_id: userId, password, set_at: new Date().toISOString() })
  } catch {
    // Before migration 041 the table does not exist; the sheet then shows
    // "Reset to issue one" for this person.
  }
}

export interface StaffLogin {
  role: 'merchandiser' | 'marketer'
  /** A role an admin added (042), shown as its own section; null for built-in. */
  addedRole?: string | null
  name: string
  email: string
  phone: string | null
  /** The temporary password, or why there is none to show. */
  password: string
  hasPassword: boolean
}

/** Every active merchandiser and marketer, with their temporary password where there is one. */
export async function staffLogins(admin: SupabaseClient): Promise<StaffLogin[]> {
  const { data: people, error } = await admin
    .from('profiles')
    .select('id, full_name, email, phone, role, must_change_password, staff_role_id')
    .in('role', ['merchandiser', 'marketer'])
    .eq('is_active', true)
    .order('full_name')
  if (error) throw new Error(error.message)

  const { data: roles } = await admin.from('staff_roles').select('id, name')
  const roleName = new Map(((roles ?? []) as { id: string; name: string }[]).map((r) => [r.id, r.name]))

  const ids = (people ?? []).map((p) => p.id as string)
  const kept = new Map<string, string>()
  if (ids.length) {
    const { data } = await admin.from('staff_temp_passwords').select('user_id, password').in('user_id', ids)
    for (const row of (data ?? []) as { user_id: string; password: string | null }[]) {
      if (row.password) kept.set(row.user_id, row.password)
    }
  }

  return (people ?? []).map((p) => {
    const temp = p.must_change_password ? kept.get(p.id as string) : undefined
    return {
      role: p.role as StaffLogin['role'],
      addedRole: p.staff_role_id ? (roleName.get(p.staff_role_id as string) ?? null) : null,
      name: p.full_name as string,
      email: p.email as string,
      phone: (p.phone as string | null) ?? null,
      password: temp ?? (p.must_change_password ? 'Reset to issue one' : 'Chosen by them'),
      hasPassword: Boolean(temp),
    }
  })
}

const ORANGE = 'D1511A'
const MUTED = '6B625C'
const TINT = 'FBEDE6'
const STRIPE = 'FAF7F5'
const TABLE_W = 9746 // A4 width less 0.75" margins, in DXA
const COLS = [480, 2700, 3266, 1600, 1700]

/**
 * The staff login sheet: how to install the app and sign in for the first
 * time, then the merchandisers and the marketers, each on their own page.
 */
export async function buildStaffLoginDoc(staff: StaffLogin[], site: string) {
  const {
    AlignmentType,
    BorderStyle,
    Document,
    Footer,
    HeadingLevel,
    LevelFormat,
    Packer,
    PageBreak,
    PageNumber,
    Paragraph,
    ShadingType,
    Table,
    TableCell,
    TableRow,
    TextRun,
    WidthType,
  } = await import('docx')

  const line = { style: BorderStyle.SINGLE, size: 4, color: 'E6E0DA' }
  const borders = { top: line, bottom: line, left: line, right: line }
  const today = new Date().toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Africa/Lagos',
  })

  const t = (text: string, o: { bold?: boolean; size?: number; color?: string } = {}) =>
    new TextRun({ text, ...o })
  const b = (text: string) => t(text, { bold: true })
  const step = (reference: string, children: DocxRun[]) =>
    new Paragraph({ numbering: { reference, level: 0 }, spacing: { after: 80 }, children })
  const h1 = (text: string) =>
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      spacing: { before: 120, after: 160 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: ORANGE, space: 6 } },
      children: [t(text)],
    })
  const h2 = (text: string) =>
    new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { before: 240, after: 100 }, children: [t(text)] })

  const cell = (
    value: string,
    width: number,
    o: { fill?: string; bold?: boolean; color?: string; mono?: boolean; right?: boolean } = {},
  ) =>
    new TableCell({
      width: { size: width, type: WidthType.DXA },
      borders,
      shading: o.fill ? { type: ShadingType.CLEAR, fill: o.fill, color: 'auto' } : undefined,
      margins: { top: 70, bottom: 70, left: 100, right: 100 },
      children: [
        new Paragraph({
          alignment: o.right ? AlignmentType.RIGHT : undefined,
          children: [
            new TextRun({ text: value, size: 19, bold: o.bold, color: o.color, font: o.mono ? 'Consolas' : undefined }),
          ],
        }),
      ],
    })

  const table = (rows: StaffLogin[]) =>
    new Table({
      width: { size: TABLE_W, type: WidthType.DXA },
      columnWidths: COLS,
      rows: [
        new TableRow({
          tableHeader: true,
          children: ['#', 'Name', 'Email', 'Phone', 'Temporary password'].map((h, i) =>
            cell(h, COLS[i], { fill: ORANGE, bold: true, color: 'FFFFFF' }),
          ),
        }),
        ...rows.map((r, i) => {
          const fill = i % 2 ? STRIPE : undefined
          return new TableRow({
            cantSplit: true,
            children: [
              cell(String(i + 1), COLS[0], { right: true, color: MUTED, fill }),
              cell(r.name, COLS[1], { bold: true, fill }),
              cell(r.email, COLS[2], { fill }),
              cell(r.phone ?? '', COLS[3], { fill }),
              r.hasPassword
                ? cell(r.password, COLS[4], { mono: true, bold: true, fill })
                : cell(r.password, COLS[4], { color: MUTED, fill }),
            ],
          })
        }),
      ],
    })

  const note = (children: DocxRun[]) =>
    new Table({
      width: { size: TABLE_W, type: WidthType.DXA },
      columnWidths: [TABLE_W],
      rows: [
        new TableRow({
          children: [
            new TableCell({
              width: { size: TABLE_W, type: WidthType.DXA },
              borders: { top: line, bottom: line, right: line, left: { style: BorderStyle.SINGLE, size: 24, color: ORANGE } },
              shading: { type: ShadingType.CLEAR, fill: TINT, color: 'auto' },
              margins: { top: 120, bottom: 120, left: 180, right: 180 },
              children: [new Paragraph({ children })],
            }),
          ],
        }),
      ],
    })

  const merch = staff.filter((s) => s.role === 'merchandiser' && !s.addedRole)
  const market = staff.filter((s) => s.role === 'marketer' && !s.addedRole)
  // Each role an admin added gets its own section, after the built-in ones.
  const added = [...new Set(staff.map((s) => s.addedRole).filter((r): r is string => Boolean(r)))].sort()
  const empty = (who: string) =>
    new Paragraph({ children: [t(`No ${who} yet.`, { color: MUTED })] })

  const numbered = (reference: string) => ({
    reference,
    levels: [
      {
        level: 0,
        format: LevelFormat.DECIMAL,
        text: '%1.',
        alignment: AlignmentType.LEFT,
        style: { paragraph: { indent: { left: 540, hanging: 360 } } },
      },
    ],
  })

  const doc = new Document({
    creator: 'Xtend',
    title: 'Xtend staff login details',
    styles: {
      default: { document: { run: { font: 'Arial', size: 21 } } },
      paragraphStyles: [
        {
          id: 'Heading1',
          name: 'Heading 1',
          basedOn: 'Normal',
          next: 'Normal',
          quickFormat: true,
          run: { size: 32, bold: true, font: 'Arial' },
          paragraph: { outlineLevel: 0 },
        },
        {
          id: 'Heading2',
          name: 'Heading 2',
          basedOn: 'Normal',
          next: 'Normal',
          quickFormat: true,
          run: { size: 24, bold: true, font: 'Arial', color: ORANGE },
          paragraph: { outlineLevel: 1 },
        },
      ],
    },
    numbering: { config: [numbered('android'), numbered('iphone'), numbered('signin')] },
    sections: [
      {
        properties: {
          page: {
            size: { width: 11906, height: 16838 },
            margin: { top: 1080, bottom: 1080, left: 1080, right: 1080 },
          },
        },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [
                  t('Xtend staff login details · confidential · page ', { size: 16, color: MUTED }),
                  new TextRun({ children: [PageNumber.CURRENT], size: 16, color: MUTED }),
                ],
              }),
            ],
          }),
        },
        children: [
          new Paragraph({ children: [t('Xtend', { bold: true, size: 44, color: ORANGE })] }),
          new Paragraph({ spacing: { after: 60 }, children: [t('Staff login details and app installation', { bold: true, size: 30 })] }),
          new Paragraph({
            spacing: { after: 240 },
            children: [
              t(
                [
                  `Prepared ${today}`,
                  `${merch.length} merchandisers`,
                  `${market.length} marketers`,
                  ...added.map((r) => `${staff.filter((s) => s.addedRole === r).length} ${r}`),
                ].join(' · '),
                { color: MUTED, size: 19 },
              ),
            ],
          }),
          note([
            b('Keep this document private. '),
            t(
              'Give each person only their own line. Xtend asks each person to choose their own password the first time they sign in; the temporary one then stops working. "Chosen by them" means the person has already done this.',
            ),
          ]),

          h2('1. Install the Xtend app'),
          new Paragraph({
            spacing: { after: 120 },
            children: [t('Open '), b(`${site}/download`), t(' on the phone. The page shows the right download for that phone.')],
          }),
          new Paragraph({ spacing: { after: 60 }, children: [b('Android (Android 7 or newer)')] }),
          step('android', [t('Tap '), b('Download for Android'), t('. The phone downloads the Xtend app file.')]),
          step('android', [t('Open the downloaded file. If the phone asks, allow your browser (e.g. Chrome) to install apps.')]),
          step('android', [t('Tap '), b('Install'), t(', then open Xtend.')]),
          new Paragraph({ spacing: { before: 120, after: 60 }, children: [b('iPhone (iOS 15 or newer)')] }),
          step('iphone', [t('Tap '), b('Get it for iPhone'), t('. If asked, install '), b('TestFlight'), t(' from the App Store first.')]),
          step('iphone', [t('Go back to the download page, tap the button again, choose '), b('Accept'), t(', then '), b('Install'), t('.')]),
          step('iphone', [
            t('If the page says '),
            b('Coming soon'),
            t(' for iPhone, open '),
            b(site),
            t(' in Safari instead, tap '),
            b('Share'),
            t(', then '),
            b('Add to Home Screen'),
            t('.'),
          ]),
          new Paragraph({
            spacing: { before: 120 },
            children: [t('No space on the phone? Xtend also works in Chrome at '), b(site), t('.')],
          }),

          h2('2. Sign in for the first time'),
          step('signin', [t('Open Xtend and sign in with your '), b('email or phone number'), t(' and the '), b('temporary password'), t(' below.')]),
          step('signin', [t('Choose your own password when Xtend asks. Pick something only you know.')]),
          step('signin', [
            t('Follow the welcome steps: take your '),
            b('profile photo'),
            t(' (it helps your team recognise you), then turn on '),
            b('location'),
            t(' and '),
            b('notifications'),
            t('. Both are needed to clock in.'),
          ]),
          step('signin', [t('You are ready. Clock in with a selfie when you arrive at work.')]),
          new Paragraph({
            spacing: { before: 160 },
            children: [
              t('Help: the guide is at '),
              b(`${site}/guide`),
              t(' and inside the app under '),
              b('You'),
              t('. Forgot your password? Ask your supervisor or the office to reset it.'),
            ],
          }),

          new Paragraph({ children: [new PageBreak()] }),
          h1(`Merchandisers (${merch.length})`),
          new Paragraph({
            spacing: { after: 160 },
            children: [t('Each merchandiser is allocated to a store and clocks in there.', { color: MUTED })],
          }),
          merch.length ? table(merch) : empty('merchandisers'),

          new Paragraph({ children: [new PageBreak()] }),
          h1(`Marketers (${market.length})`),
          new Paragraph({
            spacing: { after: 160 },
            children: [t('Marketers check in at each store they visit.', { color: MUTED })],
          }),
          market.length ? table(market) : empty('marketers'),

          ...added.flatMap((r) => {
            const people = staff.filter((s) => s.addedRole === r)
            return [
              new Paragraph({ children: [new PageBreak()] }),
              h1(`${r} (${people.length})`),
              table(people),
            ]
          }),
        ],
      },
    ],
  })

  return Packer.toBuffer(doc)
}
