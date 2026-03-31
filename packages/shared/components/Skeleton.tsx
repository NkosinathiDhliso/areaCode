import { Box } from './primitives'

interface SkeletonProps {
  className?: string
}

export function Skeleton({ className = '' }: SkeletonProps) {
  return (
    <Box
      className={`bg-[var(--bg-raised)] rounded-xl animate-pulse ${className}`}
      role="presentation"
      aria-hidden="true"
    />
  )
}

export function SkeletonCard() {
  return (
    <Box className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-2xl p-5 flex flex-col gap-3">
      <Skeleton className="h-4 w-3/4" />
      <Skeleton className="h-3 w-1/2" />
      <Skeleton className="h-3 w-2/3" />
    </Box>
  )
}

export function SkeletonAvatar({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) {
  const sizeMap = { sm: 'w-8 h-8', md: 'w-10 h-10', lg: 'w-14 h-14' }
  return <Skeleton className={`rounded-full ${sizeMap[size]}`} />
}
