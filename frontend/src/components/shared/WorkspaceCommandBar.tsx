import React from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { PageToolbar } from './LayoutPrimitives'

export const GOLDEN_COMMAND_BAR_STACK_CLASS = 'space-y-4'
export const GOLDEN_COMMAND_BAR_SECONDARY_CLASS = 'px-4 py-3'
export const GOLDEN_FILTER_CHIP_ROW_CLASS = 'flex flex-wrap items-center gap-2'

export function WorkspaceCommandBar({
  left,
  right,
  secondary,
  filterChips,
}: {
  left: React.ReactNode
  right?: React.ReactNode
  secondary?: React.ReactNode
  filterChips?: Array<{ id: string; label: string; onRemove: () => void }>
}) {
  return (
    <div className={GOLDEN_COMMAND_BAR_STACK_CLASS} data-golden-command-bar="true">
      <PageToolbar left={left} right={right} wrapOnMobile />
      {secondary ? <PageToolbar left={secondary} className={GOLDEN_COMMAND_BAR_SECONDARY_CLASS} wrapOnMobile /> : null}
      <AnimatePresence>
        {!!filterChips?.length && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            className={GOLDEN_FILTER_CHIP_ROW_CLASS}
            data-golden-filter-chip-row="true"
          >
            {filterChips.map((chip) => (
              <button
                key={chip.id}
                onClick={chip.onRemove}
                className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1.5 text-[10px] font-semibold text-slate-300 transition-all hover:border-white/20 hover:bg-white/[0.08]"
              >
                {chip.label}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
