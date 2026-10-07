/**
 * Checks what each kind of form field accepts and refuses: real names,
 * numbers and text through, junk and links out. Needs no database.
 *
 *   npx tsx --tsconfig tsconfig.scripts.json scripts/check-fields.ts
 */
import type { ZodTypeAny } from 'zod'
import { address, emailAddress, note, personName, phoneNumber, thingName, writtenText } from '@/lib/fields'

let failed = 0
function expect(schema: ZodTypeAny, input: unknown, ok: boolean, label: string, becomes?: unknown) {
  const r = schema.safeParse(input)
  const pass = r.success === ok && (becomes === undefined || (r.success && r.data === becomes))
  if (!pass) failed++
  const shown = r.success ? JSON.stringify(r.data) : r.error.issues[0]?.message
  console.log(`${pass ? 'ok  ' : 'FAIL'} ${label}: ${JSON.stringify(input)} -> ${shown}`)
}

// Names, as on the merchandiser sheet.
expect(personName, 'George Obianuju Jennifer', true, 'name')
expect(personName, '  Peters  Funmi S. ', true, 'name, tidied', 'Peters Funmi S.')
expect(personName, "Ade-Ola O'Neil", true, 'name with hyphen and apostrophe')
expect(personName, 'OJO CHRISTIANAH OPEYEMI', true, 'name in capitals')
expect(personName, 'Chidi123', false, 'name with digits')
expect(personName, 'a', false, 'one letter')
expect(personName, 'http://spam.com', false, 'a link as a name')
expect(personName, '.....', false, 'dots')

// Phones, as staff send them.
expect(phoneNumber, '08132254267', true, 'phone', '08132254267')
expect(phoneNumber, '+234 813 225 4267', true, 'phone with +234', '08132254267')
expect(phoneNumber, '2348132254267', true, 'phone with 234', '08132254267')
expect(phoneNumber, '0813-225-4267', true, 'phone with dashes', '08132254267')
expect(phoneNumber, '12345', false, 'too short')
expect(phoneNumber, '08132254267000', false, 'too long')
expect(phoneNumber, '05132254267', false, 'not a mobile prefix')
expect(phoneNumber, 'call me', false, 'words')

// Email.
expect(emailAddress, ' OtsePraise64@Gmail.com ', true, 'email, lower-cased', 'otsepraise64@gmail.com')
expect(emailAddress, 'onahchinonye@gmail,com', false, 'comma instead of dot')
expect(emailAddress, 'not-an-email', false, 'no @')

// Store, place and product names.
expect(thingName(160, 'store name'), 'Justrite Ogba', true, 'store')
expect(thingName(120, 'product name'), 'Xpel Hair Food 250ml', true, 'product')
expect(thingName(120, 'product name'), '12345', false, 'product without words')
expect(thingName(120, 'place name'), 'buy-now.xyz', false, 'a domain as a place')
expect(thingName(120, 'product name'), 'aaaaaaaaaa', false, 'one key held down')

// Addresses.
expect(address, '124 Oba Akran Ave, Ogba, Lagos', true, 'address')
expect(address, '', true, 'no address', null)
expect(address, 'www.cheap-loans.com', false, 'a link as an address')

// Written text.
const section = writtenText(2000, 15, 'the sales section')
expect(section, 'Sold 40 units of hair food, best seller was the 250ml tub.', true, 'report section')
expect(section, 'ok', false, 'too short for a required section')
expect(section, '..........................', false, 'no words')
expect(section, 'Great deals at https://spam.example now', false, 'a link')
const optional = writtenText(2000, 0, 'issues')
expect(optional, '', true, 'optional section left empty', '')
expect(optional, 'None today', true, 'optional section filled')
expect(optional, '!!!!!!!!', false, 'optional section with junk')
expect(note(), null, true, 'no note', '')
expect(note(), 'Spoke to her, she was at the bank.', true, 'note')
expect(note(), 'visit www.win-money.com', false, 'note with a link')

if (failed) {
  console.error(`${failed} failed`)
  process.exit(1)
}
console.log('all field checks passed')
