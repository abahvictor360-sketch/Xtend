/** The frame of the two-step sign-in pages, like the password page's. */
export function MfaShell({ title, intro, children }: { title: string; intro: string; children: React.ReactNode }) {
  return (
    <main className="flex min-h-dvh flex-col">
      <div className="bg-brand px-6 pb-20 pt-14 text-white safe-top">
        <div className="mx-auto w-full max-w-sm">
          <h1 className="text-[26px] font-extrabold leading-tight">{title}</h1>
          <p className="mt-2 text-sm text-white/80">{intro}</p>
        </div>
      </div>
      <div className="-mt-10 flex-1 rounded-t-[2rem] bg-background px-6 pb-10 pt-8">
        <div className="mx-auto w-full max-w-sm">{children}</div>
      </div>
    </main>
  )
}
