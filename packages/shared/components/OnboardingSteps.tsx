import { MapPin, Bell, Music, Sparkles } from 'lucide-react'
import { Button } from './Button'

interface StepProps {
  t: (key: string, fallback?: string) => string
}

interface LocationStepProps extends StepProps {
  onGrant: () => void
  onSkip: () => void
}

export function LocationStep({ onGrant, onSkip, t }: LocationStepProps) {
  return (
    <div className="flex flex-col items-center justify-center text-center flex-1">
      <div className="w-24 h-24 rounded-full bg-white/10 flex items-center justify-center mb-8">
        <MapPin size={48} className="text-white" aria-hidden="true" />
      </div>
      <h1 className="text-white text-[var(--font-2xl)] font-bold mb-3">
        {t('onboarding.location.title', 'Find what\'s happening near you')}
      </h1>
      <p className="text-white/80 text-[var(--font-base)] leading-relaxed mb-8 max-w-[300px]">
        {t('onboarding.location.description', 'Area Code uses your location to show nearby venues, check you in, and alert you when spots are buzzing.')}
      </p>
      <div className="w-full space-y-3 mt-auto">
        <Button
          variant="primary"
          size="lg"
          className="w-full bg-white text-[var(--accent-dim)] font-semibold"
          onClick={onGrant}
          aria-label={t('onboarding.location.grant', 'Grant Access')}
        >
          {t('onboarding.location.grant', 'Grant Access')}
        </Button>
        <button
          onClick={onSkip}
          className="w-full py-3 text-white/60 text-[var(--font-sm)] font-medium active:scale-95 transition-transform"
          aria-label={t('onboarding.location.skip', 'Skip for now')}
        >
          {t('onboarding.location.skip', 'Skip for now')}
        </button>
      </div>
    </div>
  )
}

interface NotificationStepProps extends StepProps {
  onEnable: () => void
  onSkip: () => void
}

export function NotificationStep({ onEnable, onSkip, t }: NotificationStepProps) {
  return (
    <div className="flex flex-col items-center justify-center text-center flex-1">
      <div className="w-24 h-24 rounded-full bg-white/10 flex items-center justify-center mb-8">
        <Bell size={48} className="text-white" aria-hidden="true" />
      </div>
      <h1 className="text-white text-[var(--font-2xl)] font-bold mb-3">
        {t('onboarding.notifications.title', 'Never miss a moment')}
      </h1>
      <p className="text-white/80 text-[var(--font-base)] leading-relaxed mb-8 max-w-[300px]">
        {t('onboarding.notifications.description', 'Get notified when your favourite spots are buzzing, when friends check in nearby, and when you unlock rewards.')}
      </p>
      <div className="w-full space-y-3 mt-auto">
        <Button
          variant="primary"
          size="lg"
          className="w-full bg-white text-[var(--accent-dim)] font-semibold"
          onClick={onEnable}
          aria-label={t('onboarding.notifications.enable', 'Enable')}
        >
          {t('onboarding.notifications.enable', 'Enable')}
        </Button>
        <button
          onClick={onSkip}
          className="w-full py-3 text-white/60 text-[var(--font-sm)] font-medium active:scale-95 transition-transform"
          aria-label={t('onboarding.notifications.skip', 'Skip')}
        >
          {t('onboarding.notifications.skip', 'Skip')}
        </button>
      </div>
    </div>
  )
}

interface MusicStepProps extends StepProps {
  onConnect: () => void
  onSkip: () => void
}

export function MusicStep({ onConnect, onSkip, t }: MusicStepProps) {
  return (
    <div className="flex flex-col items-center justify-center text-center flex-1">
      <div className="w-24 h-24 rounded-full bg-white/10 flex items-center justify-center mb-8">
        <Music size={48} className="text-white" aria-hidden="true" />
      </div>
      <h1 className="text-white text-[var(--font-2xl)] font-bold mb-3">
        {t('onboarding.music.title', 'Your music, your vibe')}
      </h1>
      <p className="text-white/80 text-[var(--font-base)] leading-relaxed mb-8 max-w-[300px]">
        {t('onboarding.music.description', 'Connect your streaming service to see the crowd vibe at venues and find spots that match your taste.')}
      </p>
      <div className="w-full space-y-3 mt-auto">
        <Button
          variant="primary"
          size="lg"
          className="w-full bg-white text-[var(--accent-dim)] font-semibold"
          onClick={onConnect}
          aria-label={t('onboarding.music.connect', 'Connect')}
        >
          {t('onboarding.music.connect', 'Connect')}
        </Button>
        <button
          onClick={onSkip}
          className="w-full py-3 text-white/60 text-[var(--font-sm)] font-medium active:scale-95 transition-transform"
          aria-label={t('onboarding.music.skip', 'Skip')}
        >
          {t('onboarding.music.skip', 'Skip')}
        </button>
      </div>
    </div>
  )
}

interface TutorialStepProps extends StepProps {
  onGotIt: () => void
  completing: boolean
}

export function TutorialStep({ onGotIt, completing, t }: TutorialStepProps) {
  return (
    <div className="flex flex-col items-center justify-center text-center flex-1">
      <div className="w-24 h-24 rounded-full bg-white/10 flex items-center justify-center mb-8">
        <Sparkles size={48} className="text-white" aria-hidden="true" />
      </div>
      <h1 className="text-white text-[var(--font-2xl)] font-bold mb-3">
        {t('onboarding.tutorial.title', 'You\'re ready to explore')}
      </h1>
      <p className="text-white/80 text-[var(--font-base)] leading-relaxed mb-4 max-w-[300px]">
        {t('onboarding.tutorial.step1', 'Tap any glowing dot on the map to see what\'s happening at a venue.')}
      </p>
      <p className="text-white/80 text-[var(--font-base)] leading-relaxed mb-4 max-w-[300px]">
        {t('onboarding.tutorial.step2', 'Check in when you arrive to earn rewards and climb the ranks.')}
      </p>
      <p className="text-white/80 text-[var(--font-base)] leading-relaxed mb-8 max-w-[300px]">
        {t('onboarding.tutorial.step3', 'The more you explore, the bigger your dots grow.')}
      </p>
      <div className="w-full mt-auto">
        <Button
          variant="primary"
          size="lg"
          className="w-full bg-white text-[var(--accent-dim)] font-semibold"
          onClick={onGotIt}
          loading={completing}
          aria-label={t('onboarding.tutorial.gotIt', 'Got it')}
        >
          {t('onboarding.tutorial.gotIt', 'Got it')}
        </Button>
      </div>
    </div>
  )
}
