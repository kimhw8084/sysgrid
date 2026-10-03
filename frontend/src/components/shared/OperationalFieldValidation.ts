export type OperationalFieldErrors = Record<string, string>

export function getOperationalFieldError(errors: OperationalFieldErrors | undefined, fieldName: string): string | undefined {
  return errors ? errors[fieldName] : undefined
}

export function mergeOperationalFieldErrors(
  existingErrors: OperationalFieldErrors,
  newErrors: OperationalFieldErrors
): OperationalFieldErrors {
  return { ...existingErrors, ...newErrors }
}

function tryParseJsonString(value: string): any {
  const trimmed = value.trim()
  if (!trimmed || (trimmed[0] !== '{' && trimmed[0] !== '[')) return null
  try {
    return JSON.parse(trimmed)
  } catch {
    return null
  }
}

function normalizeFieldMessage(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed || null
  }
  if (Array.isArray(value)) {
    const parts = value.map(normalizeFieldMessage).filter(Boolean)
    return parts.length ? parts.join(', ') : null
  }
  return null
}

function getErrorFieldName(candidate: any): string | null {
  if (typeof candidate?.field === 'string' && candidate.field.trim()) return candidate.field.trim()
  if (typeof candidate?.path === 'string' && candidate.path.trim()) return candidate.path.trim()
  if (Array.isArray(candidate?.loc)) {
    const filtered = candidate.loc
      .map((part: any) => String(part))
      .filter((part: string) => part && !['body', 'query', 'path'].includes(part))
    if (filtered.length) return filtered[0]
  }
  return null
}

function assignFieldErrors(target: OperationalFieldErrors, input: unknown) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return
  Object.entries(input as Record<string, unknown>).forEach(([field, message]) => {
    const normalized = normalizeFieldMessage(message)
    if (normalized) target[field] = normalized
  })
}

export function parseOperationalApiValidationError(error: any): {
  fieldErrors: OperationalFieldErrors
  generalError: string | null
} {
  const fieldErrors: OperationalFieldErrors = {}
  const generalMessages: string[] = []

  const collect = (input: any) => {
    if (input == null) return

    if (typeof input === 'string') {
      const parsed = tryParseJsonString(input)
      if (parsed) {
        collect(parsed)
        return
      }
      if (input.trim()) generalMessages.push(input.trim())
      return
    }

    if (input instanceof Error) {
      const fieldCount = Object.keys(fieldErrors).length
      const messageCount = generalMessages.length
      collect((input as Error & { data?: unknown }).data)
      if (Object.keys(fieldErrors).length === fieldCount && generalMessages.length === messageCount) {
        collect(input.message)
      }
      return
    }

    if (Array.isArray(input)) {
      input.forEach(collect)
      return
    }

    if (typeof input !== 'object') {
      const normalized = normalizeFieldMessage(input)
      if (normalized) generalMessages.push(normalized)
      return
    }

    assignFieldErrors(fieldErrors, input.field_errors)

    if (Array.isArray(input.errors)) {
      input.errors.forEach((entry: any) => {
        const field = getErrorFieldName(entry)
        const message = normalizeFieldMessage(entry?.message ?? entry?.msg ?? entry?.detail ?? entry)
        if (field && message) fieldErrors[field] = message
        else if (message) generalMessages.push(message)
      })
    }

    if (Array.isArray(input.detail)) {
      input.detail.forEach((entry: any) => {
        const field = getErrorFieldName(entry)
        const message = normalizeFieldMessage(entry?.msg ?? entry?.message ?? entry?.detail ?? entry)
        if (field && message) fieldErrors[field] = message
        else if (message) generalMessages.push(message)
      })
    } else if (typeof input.detail === 'string') {
      generalMessages.push(input.detail.trim())
    } else if (input.detail && typeof input.detail === 'object') {
      collect(input.detail)
    }

    const nestedMessage = typeof input.message === 'string' ? tryParseJsonString(input.message) : null
    if (nestedMessage) {
      collect(nestedMessage)
    } else if (typeof input.message === 'string' && input.message.trim()) {
      generalMessages.push(input.message.trim())
    }

    const nestedError = typeof input.error === 'string' ? tryParseJsonString(input.error) : null
    if (nestedError) {
      collect(nestedError)
    } else if (typeof input.error === 'string' && input.error.trim()) {
      generalMessages.push(input.error.trim())
    }
  }

  collect(error)

  return {
    fieldErrors,
    generalError: generalMessages.find(Boolean) || null,
  }
}
