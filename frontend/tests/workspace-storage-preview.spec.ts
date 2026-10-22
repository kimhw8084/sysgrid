import { registerStorageRecoveryTests } from './helpers/workspaceStorageRecovery'

registerStorageRecoveryTests([
  { route: '/vendors', search: 'Search vendors...', key: 'sysgrid_vendor_ui_state_v1' },
])
