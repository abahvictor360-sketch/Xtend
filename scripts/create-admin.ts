/*
 * Bootstrap the first admin. There is no public signup, so the first account
 * has to come from somewhere.
 *
 *   npx tsx scripts/create-admin.ts "Ada Okafor" ada@xpel.ng 'a-strong-password'
 *
 * Requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the env.
 */
import { createClient } from '@supabase/supabase-js'

async function main() {
  const [fullName, email, password] = process.argv.slice(2)
  if (!fullName || !email || !password) {
    console.error('Usage: tsx scripts/create-admin.ts "<full name>" <email> <password>')
    process.exit(1)
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    console.error('Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY first.')
    process.exit(1)
  }

  const supabase = createClient(url, key, { auth: { persistSession: false } })

  const { data, error } = await supabase.auth.admin.createUser({
    email: email.toLowerCase(),
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  })
  if (error || !data.user) {
    console.error('Could not create the auth user:', error?.message)
    process.exit(1)
  }

  const { error: profileError } = await supabase.from('profiles').insert({
    id: data.user.id,
    full_name: fullName,
    email: email.toLowerCase(),
    role: 'admin',
    // The password was chosen by a human here, so no forced change.
    must_change_password: false,
  })
  if (profileError) {
    await supabase.auth.admin.deleteUser(data.user.id)
    console.error('Could not create the profile:', profileError.message)
    process.exit(1)
  }

  console.log(`Admin created: ${email}`)
}

void main()
