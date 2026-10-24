# Asset initial-load warning

Navigating from another workspace can populate the shared live-device query
before Assets requests the full registry. Previously that cached array alone
activated the orange fallback warning, although the registry had not failed.
An empty successful registry response could also retain stale live rows.

Fallback now requires an actual primary query error and no usable full-registry
response. A successful registry array, including an empty array, is authoritative.
Normal loading says "Loading asset registry…"; real degraded operation remains visible.

Regression coverage must include cached rows during a delayed healthy load,
successful empty responses, genuine failure, and recovery to an empty registry.
Desktop browser coverage exercises both themes and retains the existing gate.
No delay hides the warning, and no retry, timeout or error assertion is weakened.
