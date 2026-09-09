'use client'

import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'

export function SignOutButton({ className }: { className?: string }) {
  const router = useRouter()

  return (
    <Button
      variant="outline"
      className={className}
      onClick={async () => {
        await supabase().auth.signOut()
        router.replace('/login')
        router.refresh()
      }}
    >
      Sign out
    </Button>
  )
}
