import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { NODE_CATEGORIES } from '@area-code/shared/constants/node-categories'
import type { NodeCategory } from '@area-code/shared/types'

interface CategoryFilterBarProps {
  onFilter: (category: NodeCategory | null) => void
}

export function CategoryFilterBar({ onFilter }: CategoryFilterBarProps) {
  const { t } = useTranslation()
  const [active, setActive] = useState<NodeCategory | null>(null)

  function handleTap(category: NodeCategory) {
    const next = active === category ? null : category
    setActive(next)
    onFilter(next)
  }

  return (
    <div className="flex flex-row gap-2 overflow-x-auto px-4 py-2 no-scrollbar">
      {NODE_CATEGORIES.map((cat) => (
        <button
          key={cat.value}
          onClick={() => handleTap(cat.value)}
          className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-all duration-150 ${
            active === cat.value
              ? 'gradient-accent text-white'
              : 'glass text-[var(--text-secondary)]'
          }`}
        >
          {t(`map.categories.${cat.value}`)}
        </button>
      ))}
    </div>
  )
}
