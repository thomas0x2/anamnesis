// A modal dialog (Esc or a click outside closes it) and the demo playground built on it.
import { useEffect, type ReactElement, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { DEMOS, DemoView } from '../demos'
import { Icon } from './Icon'

export function Modal({ onClose, children, width, label }: { onClose: () => void; children: ReactNode; width?: number; label?: string }): ReactElement {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  // rendered at the end of <body>: a dialog opened from the sidebar or top bar must not sit inside their
  // window-drag region, where Electron swallows clicks on everything but buttons
  return createPortal(
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={label} style={width ? { width: `min(${width}px, 100%)` } : undefined}>
        {children}
      </div>
    </div>,
    document.body
  )
}

export function DemoModal({ id, onClose }: { id: string; onClose: () => void }): ReactElement {
  const entry = DEMOS[id]
  return (
    <Modal onClose={onClose} width={860} label={entry?.title ?? 'Demo'}>
      <div className="row between" style={{ marginBottom: 12 }}>
        <h2>{entry?.title ?? id}</h2>
        <button className="btn icon sm ghost" onClick={onClose} title="Close (Esc)">
          <Icon name="x" size={16} />
        </button>
      </div>
      <DemoView id={id} params={entry?.example ?? null} />
      <p className="small muted" style={{ marginTop: 10 }}>
        Change one thing at a time and predict what the plot will do before you let go of the slider.
      </p>
    </Modal>
  )
}
