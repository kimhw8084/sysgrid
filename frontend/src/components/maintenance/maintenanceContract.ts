export type ActionDefinition = {
  action_key: string; title: string; description: string; risk_tier: string
  reversible: boolean; requires_approval: boolean; requires_recovery_facts: boolean
  adapter_id: string; production_capable: boolean
}
export type ActionCatalog = {
  adapter: { adapter_id: string; display_name: string; production_capable: boolean }
  identity: { actor_id: string; access_role: string }
  capabilities: Array<{ capability_key: string; title: string; supported: boolean; actions: ActionDefinition[] }>
}
export type OperationalAction = {
  id: string; actor_id: string; action_key: string; adapter_id: string; status: string
  risk_tier: string; requested_at: string; preview_token: string | null; preview_expires_at: string | null
  progress_percent: number; progress_message: string | null; maintenance_window_id: number | null
  normalized_parameters: Record<string, unknown>; change_context: Record<string, unknown>
  risk_facts: { requires_approval?: boolean; requires_recovery_facts?: boolean }
  precondition_snapshot: { requirements?: string[] }; rollback_plan: { available?: boolean }
  execution_result: Record<string, unknown>; rollback_outcome: Record<string, unknown>
  verification_summary: string | null; approval_facts: Record<string, unknown>; recovery_facts: Record<string, unknown>
  targets: Array<{ device_id: number; target_revision: string; target_snapshot: { name?: string; status?: string } }>
  history: Array<{ id: number; sequence: number; event_type: string; to_status: string; message: string; actor_id: string; occurred_at: string }>
  evidence: Array<{ id: number; evidence_type: string; summary: string; reference: string | null; recorded_by: string }>
  attempts: Array<{ id: string; phase: 'EXECUTION' | 'ROLLBACK'; status: string; progress_percent: number; progress_message: string; result: Record<string, unknown> }>
}

export const labelStatus = (value: string) => value.toLowerCase().replaceAll('_', ' ')
export const isActiveAttempt = (status: string) => ['REQUESTED', 'CLAIMED'].includes(status)

/** UI guidance only. The API always revalidates actor, tenant, state and preview. */
export function actionControls(action: OperationalAction, actorId: string, canWrite: boolean) {
  const owner = canWrite && action.actor_id === actorId
  const status = action.status
  return {
    owner,
    preview: owner && ['CREATED', 'PREVIEWED', 'STALE'].includes(status),
    authorize: owner && ['PREVIEWED', 'AUTHORIZED'].includes(status),
    confirm: owner && ['PREVIEWED', 'AUTHORIZED'].includes(status),
    execute: owner && status === 'CONFIRMED',
    verify: canWrite && status === 'SUCCEEDED',
    rollback: owner && Boolean(action.rollback_plan.available) && ['SUCCEEDED', 'VERIFIED', 'FAILED', 'VERIFICATION_FAILED', 'ROLLBACK_REQUESTED', 'ROLLBACK_FAILED', 'RECOVERY_REQUIRED'].includes(status),
    recover: owner && ['FAILED', 'VERIFICATION_FAILED', 'ROLLBACK_FAILED', 'RECOVERY_REQUIRED'].includes(status),
    reconcile: owner && action.attempts.some(attempt => isActiveAttempt(attempt.status)),
  }
}

export function maintenanceError(error: unknown): string {
  const value = error as { data?: { detail?: unknown }; message?: string }
  const detail = value?.data?.detail
  if (detail && typeof detail === 'object' && 'message' in detail && typeof detail.message === 'string') return detail.message
  if (typeof detail === 'string') return detail
  if (Array.isArray(detail)) return detail.map(item => item.msg || 'Invalid input').join('; ')
  return value?.message || 'The request could not be completed. Refresh the recorded state before retrying.'
}
