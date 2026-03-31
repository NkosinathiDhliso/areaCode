import { useEffect, useState } from 'react'

export function useCooldownTimer(cooldownUntil: string | null) {
  const [remaining, setRemaining] = useState(0)

  useEffect(() => {
    if (!cooldownUntil) {
      setRemaining(0)
      return
    }

    function tick() {
      const diff = new Date(cooldownUntil!).getTime() - Date.now()
      setRemaining(Math.max(0, Math.ceil(diff / 1000)))
    }

    tick()
    const interval = setInterval(tick, 1000)
    return () => clearInterval(interval)
  }, [cooldownUntil])

  const isActive = remaining > 0
  const minutes = Math.floor(remaining / 60)
  const seconds = remaining % 60
  const display = `${minutes}:${seconds.toString().padStart(2, '0')}`

  return { remaining, isActive, display }
}
