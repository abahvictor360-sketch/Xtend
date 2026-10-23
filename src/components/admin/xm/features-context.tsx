'use client'

import { createContext, useContext } from 'react'
import { XM_ALL_ON, type XmFeatures } from '@/lib/metrics/features'

const XmFeaturesContext = createContext<XmFeatures>(XM_ALL_ON)

/** Hands the X Metrics switches (0063) to the sub-navigation. */
export function XmFeaturesProvider({ features, children }: { features: XmFeatures; children: React.ReactNode }) {
  return <XmFeaturesContext.Provider value={features}>{children}</XmFeaturesContext.Provider>
}

export function useXmFeatures() {
  return useContext(XmFeaturesContext)
}
