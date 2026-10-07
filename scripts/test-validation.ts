// Checks the form rules in src/lib/validation.ts: npx tsx scripts/test-validation.ts
import { check, checkText } from '../src/lib/validation'
const cases: [string, (v: string) => string | null, string, boolean][] = [
  ['name', check.personName, 'Emmanuel Amalachukwu Chinyelu', true],
  ['name', check.personName, "Peters Funmi S.", true],
  ['name', check.personName, "O'Neil Ade-Bayo", true],
  ['name', check.personName, 'Ogbunachara  Chiamaka   Mercy ', true],
  ['name', check.personName, 'asdf123', false],
  ['name', check.personName, 'aaaaaaaa', false],
  ['name', check.personName, 'x', false],
  ['name', check.personName, 'http://spam.com', false],
  ['email', check.email, 'amalachukwuemmanuel87@gmail.com', true],
  ['email', check.email, 'NNABUIFECOMFORT2020@GMAIL.COM', true],
  ['email', check.email, 'name@gmail', false],
  ['email', check.email, 'not an email', false],
  ['phone', check.phone, '08164138337', true],
  ['phone', check.phone, '0816 413 8337', true],
  ['phone', check.phone, '+2348164138337', true],
  ['phone', check.phone, '1234567', false],
  ['phone', check.phone, '06164138337', false],
  ['place', check.placeName, 'Shoprite Ikeja City Mall', true],
  ['place', check.placeName, "Justrite (Lekki) - Store #2", true],
  ['place', check.placeName, '12345', false],
  ['place', check.placeName, 'www.buy-now.com', false],
  ['place', check.placeName, '!!!!', false],
  ['address', check.address, 'No. 5 Allen Avenue, Ikeja, Lagos', true],
  ['address', check.address, '1234', false],
  ['product', check.productName, 'Xpel Body Lotion 400ml', true],
  ['product', check.productName, '999', false],
]
let bad = 0
for (const [k, f, v, ok] of cases) {
  const r = f(v)
  if ((r === null) !== ok) { bad++; console.log('WRONG', k, JSON.stringify(v), r) }
}
const texts: [string, boolean][] = [
  ['My phone could not clock in this morning', true],
  ['ok', true],
  ['!!!!!!!!!!', false],
  ['aaaaaaaaaaaaaaa', false],
  ['Check this www.win-cash.com', false],
  ['Sold 20 units, stock low on 400ml. Need restock by Friday.', true],
]
for (const [v, ok] of texts) {
  const r = checkText(v)
  if ((r === null) !== ok) { bad++; console.log('WRONG text', JSON.stringify(v), r) }
}

console.log(bad ? `${bad} WRONG` : "all as expected")
if (bad) process.exit(1)
