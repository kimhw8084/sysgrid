const dateOffsetFromToday = (days: number) => {
  const date = new Date()
  date.setUTCHours(0, 0, 0, 0)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

export const p04ManagerFixture = {
  project: {
    name: 'Qualification Analysis Automation',
    objective: 'Reduce manual review time while preserving qualification evidence.',
    problem: 'Manual qualification review delays engineering decisions and obscures evidence handoffs.',
    owner_id: 'mina.chen',
    phase: 'Executing',
    priority: 'High',
    start_date: dateOffsetFromToday(7),
    target_date: dateOffsetFromToday(90),
    architecture_assessment: 'Yes',
    outcome_phase: 'Pilot',
  },
  delivery: { percent: 58, method: 'Weighted by canonical planning weight.' },
  milestone: { title: 'Pilot validation', point_date: dateOffsetFromToday(60) },
  blocker: { reason: 'Validation dataset approval', resolver_id: 'mina.chen', review_date: dateOffsetFromToday(45) },
  outcome: { phase: 'Pilot', result: 'Unassessed', display: 'Not yet verified' },
} as const
