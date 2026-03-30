import type { HTMLAttributes, ReactNode } from 'react'

interface PrimitiveProps extends HTMLAttributes<HTMLDivElement> {
  children?: ReactNode
  className?: string
}

export function Box({ children, className, ...props }: PrimitiveProps) {
  return (
    <div className={className} {...props}>
      {children}
    </div>
  )
}

export function Text({ children, className, ...props }: PrimitiveProps) {
  return (
    <span className={className} {...props}>
      {children}
    </span>
  )
}

export function Row({ children, className, ...props }: PrimitiveProps) {
  return (
    <div className={`flex flex-row ${className ?? ''}`} {...props}>
      {children}
    </div>
  )
}
