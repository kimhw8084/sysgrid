import { describe, expect, it } from 'vitest'
import { effectiveIdentityChanged, resolveModuleActionState, type EffectiveModulePolicy } from './ModulePolicy'

const policyFor = (moduleId: string, override: Partial<EffectiveModulePolicy> = {}) => ({
  modules: {
    [moduleId]: {
      module_id: moduleId,
      label: moduleId,
      stage: 'preview',
      default_stage: 'preview',
      available: false,
      blocked_reason: 'SYSTEM_ROOT_REQUIRED',
      root_preview: false,
      ...override,
    },
  },
}) as any

describe('central module release action policy', () => {
  it('detects authenticated proxy identity changes, including sign-out, without treating initial load as a switch', () => {
    expect(effectiveIdentityChanged(undefined, 'account-a')).toBe(false)
    expect(effectiveIdentityChanged('account-a', 'account-a')).toBe(false)
    expect(effectiveIdentityChanged('account-a', 'account-b')).toBe(true)
    expect(effectiveIdentityChanged('account-a', null)).toBe(true)
  })
  it('keeps released actions usable while policy is loading or unavailable', () => {
    const loading = resolveModuleActionState('knowledge', { isLoading: true })
    const errored = resolveModuleActionState('knowledge', { isError: true })

    expect(loading.disabled).toBe(false)
    expect(errored.disabled).toBe(false)
  })

  it('fails closed for explicit preview actions while policy is loading or unavailable', () => {
    const previewPolicy = policyFor('knowledge', {
      stage: 'preview',
      default_stage: 'preview',
      available: false,
      blocked_reason: 'SYSTEM_ROOT_REQUIRED',
      root_preview: false,
    })
    const loading = resolveModuleActionState('knowledge', { data: previewPolicy, isLoading: true })
    const errored = resolveModuleActionState('knowledge', { data: previewPolicy, isError: true })

    expect(loading.disabled).toBe(true)
    expect(loading.reason).toMatch(/Preview unavailable/i)
    expect(errored.disabled).toBe(true)
    expect(errored.reason).toMatch(/release policy is not available/i)
  })

  it('activates root-preview only from effective backend policy', () => {
    const root = resolveModuleActionState('knowledge', {
      data: policyFor('knowledge', { available: true, blocked_reason: null, root_preview: true }),
    })

    expect(root.disabled).toBe(false)
    expect(root.rootPreview).toBe(true)
  })

  it('keeps disabled and retired stages unavailable even for root-preview', () => {
    const disabled = resolveModuleActionState('knowledge', {
      data: policyFor('knowledge', { stage: 'disabled', available: false, blocked_reason: 'MODULE_DISABLED', root_preview: false }),
    })
    const retired = resolveModuleActionState('knowledge', {
      data: policyFor('knowledge', { stage: 'retired', available: false, blocked_reason: 'MODULE_RETIRED', root_preview: false }),
    })

    expect(disabled.disabled).toBe(true)
    expect(disabled.reason).toMatch(/module disabled/i)
    expect(retired.disabled).toBe(true)
    expect(retired.reason).toMatch(/module retired/i)
  })
})
