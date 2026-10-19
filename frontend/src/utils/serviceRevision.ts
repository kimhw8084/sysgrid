export function withServiceEditRevision(payload: any, snapshot: any) {
  if (!snapshot?.id) return payload
  if (typeof snapshot.edit_revision !== 'string' || !/^[0-9a-f]{32}$/.test(snapshot.edit_revision)) {
    throw new Error('The service edit revision is unavailable. Your draft is preserved. Copy your changes, then reload and reopen the service before saving.')
  }
  return { ...payload, expected_revision: snapshot.edit_revision }
}
