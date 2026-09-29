'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

let workerStart: Promise<unknown> | null = null

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: {
      queries: { staleTime: 30_000, retry: 2, refetchOnWindowFocus: false },
      mutations: { retry: 0 },
    },
  }))

  useEffect(() => {
    if (!workerStart) {
      workerStart = import('@/mocks/browser').then(({ worker }) => worker.start({
        onUnhandledRequest: 'bypass',
        serviceWorker: { url: '/mockServiceWorker.js' },
      }))
    }
  }, [])

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}
