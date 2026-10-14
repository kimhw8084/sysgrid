import React from 'react'
import { Share } from 'lucide-react'
import toast from 'react-hot-toast'

interface WorkspaceShareHeaderProps {
  id: string
  title: string
}

export const WorkspaceShareHeader: React.FC<WorkspaceShareHeaderProps> = ({ id, title }) => {
  const inFlight = React.useRef(false)
  const [copying, setCopying] = React.useState(false)
  const noticeId = React.useId()

  const copyLink = async () => {
    if (inFlight.current) return
    inFlight.current = true
    setCopying(true)
    try {
      const url = new URL(window.location.href)
      url.searchParams.set('id', String(id))
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable')
      await navigator.clipboard.writeText(url.toString())
      toast.success('Direct link copied to clipboard', { id: noticeId })
    } catch {
      toast.error('Could not copy the link. Check clipboard access and try again.', { id: noticeId })
    } finally {
      inFlight.current = false
      setCopying(false)
    }
  }

  return (
    <button
      type="button"
      onClick={copyLink}
      disabled={copying}
      aria-busy={copying}
      aria-label="Share direct link"
      aria-description={`Copy a link to ${title}`}
      className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--action-primary)] disabled:cursor-wait"
      title="Share direct link"
    >
      <Share size={16} aria-hidden="true" />
    </button>
  )
}
