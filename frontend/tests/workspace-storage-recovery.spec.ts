import { registerStorageRecoveryTests } from './helpers/workspaceStorageRecovery'

registerStorageRecoveryTests([
  { route: '/services', search: 'Search services, hosts, or metadata...', key: 'sysgrid_services_ui_state_v1', serverKey: 'services_workspace_state_v1' },
  { route: '/monitoring', search: 'Scan matrix...', key: 'sysgrid_monitoring_ui_state_v1', serverKey: 'monitoring_workspace_state_v2' },
  { route: '/network', search: 'Scan matrix...', key: 'sysgrid_network_ui_state_v1' },
  { route: '/asset', search: 'Scan asset matrix...', key: 'sysgrid_asset_golden_workspace_v34' },
], ['sidebar', 'settings'])
