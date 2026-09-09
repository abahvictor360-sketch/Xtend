'use client'

import { useRouter } from 'next/navigation'
import { LogOut } from 'lucide-react'
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
      <LogOut className="h-4 w-4" />
      Sign out
    </Button>
  )
}
