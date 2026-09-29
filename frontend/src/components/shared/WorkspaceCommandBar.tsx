import React, { useId, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { PageToolbar } from './LayoutPrimitives'
import { ChevronDown, Sliders } from 'lucide-react'

export const GOLDEN_COMMAND_BAR_STACK_CLASS = 'space-y-4'
export const GOLDEN_COMMAND_BAR_SECONDARY_CLASS = 'px-4 py-3'
export const GOLDEN_FILTER_CHIP_ROW_CLASS = 'flex flex-wrap items-center gap-2'

export function WorkspaceCommandBar({
  left,
  controls,
  right,
  secondary,
  filterChips,
}: {
  left: React.ReactNode
  controls?: React.ReactNode
  right?: React.ReactNode
  secondary?: React.ReactNode
  filterChips?: Array<{ id: string; label: string; onRemove: () => void }>
}) {
  const [toolsOpen, setToolsOpen] = useState(false)
  const controlsId = useId()
  const compactExpanded = !controls || toolsOpen
  return (
    <div className={GOLDEN_COMMAND_BAR_STACK_CLASS} data-golden-command-bar="true">
      <PageToolbar left={<>
        {left}
        {controls && <>
          <button type="button" aria-expanded={toolsOpen} aria-controls={controlsId} onClick={() => setToolsOpen(open => !open)} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-[var(--border-default)] bg-[var(--surface-base)] px-3 text-xs font-semibold text-[var(--text-primary)] md:hidden">
            <Sliders size={14} aria-hidden="true" /> View & filters <ChevronDown size={14} aria-hidden="true" className={toolsOpen ? 'rotate-180' : ''} />
          </button>
          <div id={controlsId} data-workspace-view-tools className={`${toolsOpen ? 'flex' : 'hidden'} min-w-0 flex-wrap items-center gap-3 md:contents`}>{controls}</div>
        </>}
      </>} right={right} wrapOnMobile />
      {secondary ? <div className={compactExpanded ? 'block' : 'hidden md:block'}><PageToolbar left={secondary} className={GOLDEN_COMMAND_BAR_SECONDARY_CLASS} wrapOnMobile /></div> : null}
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
                className="min-h-10 rounded-lg border border-[var(--border-default)] bg-[var(--surface-elevated)] px-3 py-2 text-xs font-medium text-[var(--text-primary)] transition-colors hover:bg-[var(--surface-hover)]"
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
