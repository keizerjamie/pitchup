import { ViewTransition } from 'react'

export default function PageTransition({ children }: { children: React.ReactNode }) {
  return (
    <ViewTransition
      enter={{
        'nav-forward': 'nav-forward',
        'nav-back':    'nav-back',
        default:       'cross-fade',
      }}
      exit={{
        'nav-forward': 'nav-forward',
        'nav-back':    'nav-back',
        default:       'cross-fade',
      }}
    >
      {children}
    </ViewTransition>
  )
}
