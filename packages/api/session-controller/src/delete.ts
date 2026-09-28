/** Session deletion: live-owner teardown, durable removal, and registry hygiene. */

import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-persistence'
import type {} from '@deepseek-ai/dsh-session-projection-cache'
import type {} from '@deepseek-ai/dsh-workspace'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import type { ApiSessionAgentController } from './agent.ts'
import type { SessionDeleteRequest, SessionDeleteValue } from './types.ts'

/**
 * Deletes one Session: the Agent this Controller owns is torn down first (so no
 * live writer can outlive the log), then the durable artifact, the projection
 * checkpoint, and this Session's Workspace/archive/pin membership go with it.
 *
 * The Controller owns every Agent it resumed or created, so an attached Session
 * is deletable — the deletion is the teardown. An Agent owned by another
 * subsystem (a subagent's, or one the loop started itself) is refused rather
 * than deleted from under its owner.
 */
export class SessionDeleteController {
  /**
   * @param ctx - Host context carrying persistence, projection cache, Workspace registry, and Agent registry.
   * @param agents - sole owner of the Agents this Controller resumed or created.
   */
  constructor(
    private readonly ctx: Context,
    private readonly agents: ApiSessionAgentController,
  ) {}

  /**
   * Delete one Session's durable record.
   * @param request - Session identity and whether confirmed running work is stopped.
   * @param signal - optional cancellation for the persistence deletion.
   * @returns whether a durable record existed and was removed.
   * @throws {RemoteError} `gateway/bad-request` for an empty id, `session/agent-busy`
   *   while work still runs without `stopActivity`, when another owner holds the
   *   Agent, or when a writer still holds the log; `session/not-found` when
   *   nothing live or durable carries the id.
   */
  async delete(request: SessionDeleteRequest, signal?: AbortSignal): Promise<SessionDeleteValue> {
    const sessionId = request.sessionId
    if (typeof sessionId !== 'string' || sessionId.length === 0) {
      throw new RemoteError('gateway/bad-request', 'session.delete requires a session id', {})
    }
    signal?.throwIfAborted()
    const live = this.ctx.agents.get(sessionId) !== undefined
    if (live) {
      if (this.ctx.agents.get(sessionId)?.status === 'running' && request.stopActivity !== true) {
        throw new RemoteError('session/agent-busy', `session "${sessionId}" still has running work`, { reason: 'running-work' })
      }
      if (!await this.agents.disposeOwnedAgent(sessionId)) {
        throw new RemoteError(
          'session/agent-busy',
          `session "${sessionId}" is attached under another owner and cannot be deleted here`,
          { reason: 'foreign-owner' },
        )
      }
    }

    const persistence = this.ctx.get('sessionPersistence')
    if (persistence === undefined) {
      throw new RemoteError('gateway/internal', 'session persistence is not configured', {})
    }
    let removed: boolean
    try {
      removed = await persistence.remove(sessionId, signal === undefined ? {} : { signal })
    } catch (error: unknown) {
      if (error instanceof Error && error.name === 'SessionAlreadyOwnedError') {
        throw new RemoteError('session/writer-held', `session "${sessionId}" is being written`, { sessionId })
      }
      throw error
    }
    if (!removed && !live) {
      throw new RemoteError('session/not-found', `session "${sessionId}" not found`, { sessionId })
    }

    this.dropProjectionCheckpoint(sessionId, removed)
    await this.forgetMembership(sessionId)
    this.ctx.emit('api-session/removed', sessionId)
    return { deleted: removed }
  }

  /** Drop the cached projection row, whose values outlive nothing but the deleted log. */
  private dropProjectionCheckpoint(sessionId: SessionId, removed: boolean): void {
    if (!removed) return
    const cache = this.ctx.get('sessionProjectionCache')
    if (cache === undefined) return
    void cache.drop(sessionId).catch((error: unknown) => {
      this.ctx.logger.warn(`session-controller: dropped checkpoint for "${sessionId}" failed: ${String(error)}`)
    })
  }

  /** Remove the deleted Session from every Workspace account plus the archive and pin sets. */
  private async forgetMembership(sessionId: SessionId): Promise<void> {
    const registry = this.ctx.workspaceRegistry
    // Membership is detached after the log is gone, so the account getter may
    // already filter the id out; detaching is idempotent and unconditional.
    for (const workspace of registry.list()) await workspace.detachSession(sessionId)
    if (registry.archivedSessionIds.includes(sessionId)) await registry.unarchiveSession(sessionId)
    if (registry.pinnedSessionIds.includes(sessionId)) await registry.unpinSession(sessionId)
  }
}
