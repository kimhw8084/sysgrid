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
