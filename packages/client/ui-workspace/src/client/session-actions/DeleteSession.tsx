/**
 * The delete action: a `sidebar.workspaces.session.menu.item` row plus the
 * `shell.overlay` dialog that asks first when the Session still has running
 * work. Unlike archiving, deletion is final — no undo and no notice — so the
 * menu row never runs without the confirmation the Host's refusal raises.
 */
import { useState } from 'react'
import { Button, IconTrashOutlineRegular, MenuItemButton, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  DeleteSessionInjected, SessionDeleteConfirmInjected, SessionDeleteConfirmProps,
  SessionDeleteConfirmRequest, SessionMenuItemProps,
} from '../contract/slots.ts'
import browserCss from '../rows/WorkspaceBrowser.module.css'

/**
 * Menu row (order 500): delete the Session, asking first when work still runs.
 * @param props - owner share, the delete share, and the menu open state.
 * @returns the row.
 */
export function DeleteSessionMenuItem({
  sessionId, useMenuOpenState, deleteSession, t,
}: SessionMenuItemProps<DeleteSessionInjected>) {
  const [, setMenuOpen] = useMenuOpenState()
  return (
    <MenuItemButton
      icon={<IconTrashOutlineRegular size={14} />}
      onSelect={() => {
        setMenuOpen(false)
        deleteSession(sessionId)
      }}
    >
      {t('menu.deleteSession')}
    </MenuItemButton>
  )
}

/**
 * The `shell.overlay` entry: nothing while no confirmation is pending,
 * otherwise one dialog per request (keyed by the Session). Confirming asks the
 * Host to stop the listed work and delete the Session.
 * @param props - the request hook, its settlement, the stop-and-delete hop, and the locale seat.
 * @returns the open dialog, or null.
 */
export function SessionDeleteConfirmDialog({
  useDeleteRequest, settleSessionDelete, stopAndDeleteSession, t,
}: SessionDeleteConfirmProps) {
  const request = useDeleteRequest(pending => pending)
  if (request === null) return null
  return (
    <DeleteConfirmForm
      key={request.sessionId}
      request={request}
      stopAndDeleteSession={stopAndDeleteSession}
      onSettle={settleSessionDelete}
      t={t}
    />
  )
}

/** One request's dialog: in-flight and error state die with it. */
function DeleteConfirmForm({ request, stopAndDeleteSession, onSettle, t }: {
  request: SessionDeleteConfirmRequest
  stopAndDeleteSession: SessionDeleteConfirmInjected['stopAndDeleteSession']
  onSettle: () => void
  t: SessionDeleteConfirmProps['t']
}) {
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const close = () => {
    if (deleting) return
    onSettle()
  }
  const confirm = () => {
    setDeleting(true)
    setError(null)
    stopAndDeleteSession(request.sessionId).then(() => {
      setDeleting(false)
      onSettle()
    }).catch((reason: unknown) => {
      setDeleting(false)
      setError(reason instanceof Error ? reason.message : String(reason))
    })
  }
  return (
    <Modal
      open
      onClose={close}
      closeLabel={t('close')}
      title={t('delete.session.title')}
      description={t('delete.session.desc', { title: request.displayTitle })}
      footer={(
        <>
          <Button variant="outline" disabled={deleting} onClick={close}>{t('cancel')}</Button>
          <Button
            variant="outline"
            className={browserCss.deleteAction}
            disabled={deleting}
            onClick={confirm}
          >
            {t('delete.session.action')}
          </Button>
        </>
      )}
    >
      <p className={browserCss.archiveActivity}>{t('delete.session.running')}</p>
      {deleting && <div className={browserCss.deleteStatus} role="status">{t('delete.session.pending')}</div>}
      {error !== null && <div className={browserCss.renameError} role="alert">{error}</div>}
    </Modal>
  )
}
