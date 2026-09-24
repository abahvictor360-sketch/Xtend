import 'server-only'
import Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'
import { ApiError } from '@/lib/auth'

/** Base64 of a ~3 MB file, which keeps the request under the platform's body limit. */
export const MAX_ATTACHMENT_BASE64 = 4_200_000
const MAX_TEXT = 150_000

export const attachmentSchema = z.object({
  name: z.string().trim().min(1).max(200),
  type: z.string().max(200),
  data: z.string().min(1).max(MAX_ATTACHMENT_BASE64),
})

export type Attachment = z.infer<typeof attachmentSchema>

const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] as const
type ImageType = (typeof IMAGE_TYPES)[number]

function clip(text: string) {
  return text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT)}\n…(file cut short)` : text
}

async function spreadsheetText(buffer: Buffer) {
  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(buffer as unknown as ArrayBuffer)
  const sheets: string[] = []
  wb.eachSheet((ws) => {
    const rows: string[] = []
    ws.eachRow((row) => {
      const values = (row.values as unknown[]).slice(1).map((v) => {
        const cell =
          v && typeof v === 'object'
            ? 'text' in v
              ? String((v as { text: unknown }).text)
              : 'result' in v
                ? String((v as { result: unknown }).result)
                : 'richText' in v
                  ? (v as { richText: { text: string }[] }).richText.map((r) => r.text).join('')
                  : JSON.stringify(v)
            : v instanceof Date
              ? v.toISOString().slice(0, 10)
              : String(v ?? '')
        return /[",\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell
      })
      rows.push(values.join(','))
    })
    sheets.push(`Sheet "${ws.name}":\n${rows.join('\n')}`)
  })
  return sheets.join('\n\n')
}

/** The content blocks that put an uploaded file in front of the model. */
export async function attachmentBlocks(
  file: Attachment,
): Promise<Anthropic.Beta.BetaContentBlockParam[]> {
  const name = file.name
  const lower = name.toLowerCase()
  const type = file.type.toLowerCase()

  if ((IMAGE_TYPES as readonly string[]).includes(type)) {
    return [
      { type: 'text', text: `Attached image: ${name}` },
      { type: 'image', source: { type: 'base64', media_type: type as ImageType, data: file.data } },
    ]
  }
  if (type === 'application/pdf' || lower.endsWith('.pdf')) {
    return [
      {
        type: 'document',
        title: name,
        source: { type: 'base64', media_type: 'application/pdf', data: file.data },
      },
    ]
  }

  const buffer = Buffer.from(file.data, 'base64')
  if (lower.endsWith('.xlsx') || type.includes('spreadsheetml')) {
    try {
      return [{ type: 'text', text: `Attached spreadsheet ${name}, as CSV:\n\n${clip(await spreadsheetText(buffer))}` }]
    } catch {
      throw new ApiError('That spreadsheet could not be read. Save it as .xlsx or .csv and try again.', 400)
    }
  }
  if (lower.endsWith('.xls') || lower.endsWith('.doc') || lower.endsWith('.docx')) {
    throw new ApiError('Save the file as .xlsx, .csv or PDF and attach it again.', 400)
  }

  const text = buffer.toString('utf8')
  // Anything else must at least look like text.
  if (text.includes('\u0000')) {
    throw new ApiError('That kind of file cannot be read. Attach a CSV, Excel, text, PDF or photo.', 400)
  }
  return [{ type: 'text', text: `Attached file ${name}:\n\n${clip(text)}` }]
}
