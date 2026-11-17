export type SysGridTheme = 'nordic-frost-v1' | 'pure-clarity'

export const SYSGRID_THEMES: readonly SysGridTheme[] = [
  'nordic-frost-v1',
  'pure-clarity',
]

/** Keep the persisted legacy light/dark aliases compatible with the V2 theme ids. */
export const normalizeTheme = (theme?: string | null): SysGridTheme => {
  if (theme === 'dark') return 'nordic-frost-v1'
  if (theme === 'light') return 'pure-clarity'
  if (theme === 'pure-clarity' || theme === 'nordic-frost-v1') return theme
  return 'nordic-frost-v1'
}

export const shouldInitializeThemeFromServer = (hasLocalPreference: boolean, serverPreferenceAlreadyChecked: boolean) => (
  !hasLocalPreference && !serverPreferenceAlreadyChecked
)

export function applySysGridTheme(theme?: string | null) {
  const normalizedTheme = normalizeTheme(theme)
  if (typeof document === 'undefined') return normalizedTheme

  document.documentElement.setAttribute('data-theme', normalizedTheme)
  document.documentElement.classList.toggle('dark', normalizedTheme !== 'pure-clarity')
  document.querySelector<HTMLElement>('.nova-app-shell')?.setAttribute('data-theme', normalizedTheme)
  return normalizedTheme
}
