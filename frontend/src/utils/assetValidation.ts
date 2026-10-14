type AssetScalarInput = { size_u?: unknown; power_typical_w?: unknown; power_max_w?: unknown }

function inputNumber(value: unknown, emptyDefault: number): number {
  if (value == null || value === '') return emptyDefault
  return typeof value === 'number' || typeof value === 'string' ? Number(value) : Number.NaN
}

export function buildAssetScalarErrors(data: AssetScalarInput): Record<string, string> {
  const errors: Record<string, string> = {}
  const size = inputNumber(data.size_u, 1)
  if (!Number.isInteger(size) || size < 1) errors.size_u = 'Size must be a whole number of at least 1.'
  else if (!Number.isSafeInteger(size)) errors.size_u = 'Size exceeds the supported whole-number limit.'
  for (const [field, label] of [['power_typical_w', 'Typical power'], ['power_max_w', 'Max power']] as const) {
    const value = inputNumber(data[field], 0)
    if (!Number.isFinite(value) || value < 0) errors[field] = `${label} must be a finite number of zero or more.`
  }
  return errors
}
