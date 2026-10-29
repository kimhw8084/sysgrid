import { describe, expect, it } from 'vitest'
import { axisCells, fitScale, taskGeometry, canonicalTaskStatus, readableProjectDate } from './ProjectsVisualRepair.geometry'
const day = (d: string) => Date.parse(d+'T00:00:00Z')/86400000
describe('Projects visual repair geometry and presentation', () => {
 it('fits the available pane without a preset approximation', () => { for (const [width,rail] of [[370,159],[1120,320],[2400,320]]) expect(274*fitScale(274,width,rail)).toBeLessThanOrEqual(width-rail) })
 it('anchors both milestone relations at the visible diamond center', () => { const g=taskGeometry({startOrdinal:1,endOrdinal:7,milestone:true},0,12);expect(g.start).toBe(g.finish);expect(g.start).toBe(g.left+g.width/2) })
 it('retains duration-width task edges', () => { expect(taskGeometry({startOrdinal:1,endOrdinal:7},0,12)).toMatchObject({left:12,width:84,start:12,finish:96}) })
 it('uses calendar month lengths, including a leap February', () => {const c=axisCells(day('2024-02-01'),day('2024-04-30'),4,0,500);expect(c[0].start).toBe(day('2024-02-01'));expect(c[0].end).toBe(day('2024-03-01'))})
 it('labels day and week axes once per month', () => {
  const daily=axisCells(day('2026-08-20'),day('2026-10-31'),32,0,32*30).map(cell=>cell.major).filter(Boolean)
  const weekly=axisCells(day('2026-08-03'),day('2026-10-31'),16,0,16*90).map(cell=>cell.major).filter(Boolean)
  expect(daily).toEqual(['Aug 2026','Sep 2026'])
  expect(weekly).toEqual(['Aug 2026','Sep 2026','Oct 2026'])
 })
 it('bounds calendar realization during long schedules and scrolling', () => {for(const scale of [.001,.5,2.2,5,12,28,100]) { const c=axisCells(day('2020-01-01'),day('2050-01-01'),scale,1000,2560);expect(c.length).toBeLessThanOrEqual(30);for(const x of c)expect(x.end).toBeGreaterThan(x.start) }})
 it('presents Done as Completed but preserves unknown values', () => { expect(canonicalTaskStatus(' Done ')).toBe('Completed');expect(canonicalTaskStatus('Deferred')).toBe('Deferred');expect(canonicalTaskStatus(null)).toBe('') })
 it('does not mutate a task while presenting its status', () => {const task={status:'Done'};canonicalTaskStatus(task.status);expect(task.status).toBe('Done')})
 it('formats calendar dates independently of the host timezone', () => {expect(readableProjectDate('2026-09-05T23:00:00Z')).toBe('Sep 5, 2026');expect(readableProjectDate(null)).toBe('Not scheduled')})
})
