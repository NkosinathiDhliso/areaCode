import { useCallback, useState } from 'react'

import { api, type ApiError } from '../lib/api'
import type { CheckInRequest, CheckInResponse } from '../types'

export function useCheckIn() {
  const [isPending, setIsPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [qrFallback, setQrFallback] = useState(false)

  const checkIn = useCallback(async (payload: CheckInRequest): Promise<CheckInResponse | null> => {
    setIsPending(true)
    setError(null)
    setQrFallback(false)
    try {
      const res = await api.post<CheckInResponse>('/v1/check-in', payload)
      return res
    } catch (err) {
      const apiError = err as ApiError
      if (apiError.statusCode === 422 && apiError.error === 'accuracy_insufficient') {
        setQrFallback(true)
        setError('accuracy_insufficient')
      } else {
        const message = apiError.message ?? 'Check-in failed'
        setError(message)
      }
      return null
    } finally {
      setIsPending(false)
    }
  }, [])

  const resetQrFallback = useCallback(() => {
    setQrFallback(false)
  }, [])

  return { checkIn, isPending, error, qrFallback, resetQrFallback }
}
