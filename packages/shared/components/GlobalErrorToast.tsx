import { useEffect } from 'react'

import { setApiErrorHandler } from '../lib/api'
import { useErrorStore } from '../stores/errorStore'

import { ErrorToast } from './ErrorToast'

export function GlobalErrorToast() {
  const error = useErrorStore((s) => s.error)
  const clearError = useErrorStore((s) => s.clearError)

  // Wire the error store into the API client on mount
  useEffect(() => {
    setApiErrorHandler(useErrorStore.getState().showError)
  }, [])

  if (!error) return null

  return <ErrorToast message={error} onDismiss={clearError} autoDismissMs={5000} />
}
