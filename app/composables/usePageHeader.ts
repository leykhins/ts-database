type PageHeader = {
  title: string
  eyebrow?: string
}

/**
 * Pages declare what the topbar says. Keeps the shell dumb and stops every
 * screen from re-implementing the same header row.
 */
export function usePageHeader(header?: MaybeRefOrGetter<PageHeader>) {
  const state = useState<PageHeader>('page-header', () => ({ title: 'TS Database' }))

  if (header) {
    watchEffect(() => {
      state.value = toValue(header)
    })
  }

  return state
}
