import { useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '../lib/api'
import { LocationStep, NotificationStep, MusicStep, TutorialStep } from './OnboardingSteps'

type OnboardingStepId = 'location' | 'notifications' | 'music' | 'tutorial'

const STEPS: OnboardingStepId[] = ['location', 'notifications', 'music', 'tutorial']

interface OnboardingFlowProps {
  onComplete: () => void
}

function ProgressDots({ current, total }: { current: number; total: number }) {
  return (
    <div className="flex gap-2 justify-center" role="progressbar" aria-valuenow={current + 1} aria-valuemax={total}>
      {Array.from({ length: total }).map((_, i) => (
        <div
          key={i}
          className={`w-2 h-2 rounded-full transition-all duration-300 ${
            i === current ? 'w-6 bg-[var(--accent-bright)]' : i < current ? 'bg-[var(--accent)]' : 'bg-[var(--border-strong)]'
          }`}
        />
      ))}
    </div>
  )
}

export function OnboardingFlow({ onComplete }: OnboardingFlowProps) {
  const { t } = useTranslation()
  const [currentStep, setCurrentStep] = useState(0)
  const [completing, setCompleting] = useState(false)

  const advance = useCallback(() => {
    if (currentStep < STEPS.length - 1) {
      setCurrentStep((s) => s + 1)
    }
  }, [currentStep])

  const handleComplete = useCallback(async () => {
    setCompleting(true)
    try {
      await api.post('/v1/users/me/onboarding/complete')
      onComplete()
    } catch {
      // Silently complete client-side even if API fails
      onComplete()
    }
  }, [onComplete])

  const handleLocationGrant = useCallback(() => {
    if ('geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(() => advance(), () => advance(), { enableHighAccuracy: true })
    } else {
      advance()
    }
  }, [advance])

  const handleNotificationEnable = useCallback(async () => {
    try {
      if ('Notification' in window) {
        await Notification.requestPermission()
      }
    } catch {
      // Permission denied — continue
    }
    advance()
  }, [advance])

  const translate = useCallback((key: string, fallback?: string) => t(key, fallback ?? key), [t])

  return (
    <div
      className="fixed inset-0 z-[9999] flex flex-col"
      style={{ background: 'var(--gradient-primary)' }}
    >
      <div className="flex-1 flex flex-col w-full max-w-[400px] mx-auto py-8 px-5">
        <div className="pt-4 pb-6">
          <ProgressDots current={currentStep} total={STEPS.length} />
        </div>

        {STEPS[currentStep] === 'location' && (
          <LocationStep onGrant={handleLocationGrant} onSkip={advance} t={translate} />
        )}
        {STEPS[currentStep] === 'notifications' && (
          <NotificationStep onEnable={handleNotificationEnable} onSkip={advance} t={translate} />
        )}
        {STEPS[currentStep] === 'music' && (
          <MusicStep onConnect={advance} onSkip={advance} t={translate} />
        )}
        {STEPS[currentStep] === 'tutorial' && (
          <TutorialStep onGotIt={handleComplete} completing={completing} t={translate} />
        )}
      </div>
    </div>
  )
}
