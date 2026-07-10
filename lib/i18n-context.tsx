'use client'

import { createContext, useContext } from 'react'
import type { Dict } from '@/messages/nl'

const DictContext = createContext<Dict | null>(null)

export function DictProvider({ dict, children }: { dict: Dict; children: React.ReactNode }) {
  return <DictContext.Provider value={dict}>{children}</DictContext.Provider>
}

export function useDict(): Dict {
  const dict = useContext(DictContext)
  if (!dict) throw new Error('useDict must be used within DictProvider')
  return dict
}
