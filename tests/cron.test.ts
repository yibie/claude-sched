import { describe, expect, test } from 'claude-code/testing'
import { formatLocal, lastMatch, matches, nextMatch, parseCron, parseOffset } from '../hooks/cron.ts'

const PST = -8 * 60
// 2026-11-11 09:13 in America/Los_Angeles (UTC-8) is 17:13 UTC.
const AT_0913_PST = Date.UTC(2026, 10, 11, 17, 13)

describe('cron', () => {
  test('daily 09:13 matches local time, not UTC', async () => {
    const c = parseCron('13 9 * * *')
    expect(matches(c, AT_0913_PST, PST)).toBe(true)
    expect(matches(c, AT_0913_PST, 0)).toBe(false)
  })

  test('next and last match around the slot', async () => {
    const c = parseCron('13 9 * * *')
    expect(nextMatch(c, AT_0913_PST - 60_000, PST)).toBe(AT_0913_PST)
    expect(lastMatch(c, AT_0913_PST + 5 * 60_000, PST)).toBe(AT_0913_PST)
    expect(nextMatch(c, AT_0913_PST, PST)).toBe(AT_0913_PST + 24 * 3600_000)
  })

  test('steps, ranges, lists and day-of-week', async () => {
    const c = parseCron('*/15 9-17 * * 1-5')
    // 2026-11-11 is a Wednesday.
    expect(matches(c, Date.UTC(2026, 10, 11, 17, 30), PST)).toBe(true)
    expect(matches(c, Date.UTC(2026, 10, 11, 17, 31), PST)).toBe(false)
    // Saturday 2026-11-14 09:30 local.
    expect(matches(c, Date.UTC(2026, 10, 14, 17, 30), PST)).toBe(false)
    expect([...parseCron('0 0 * * 7').dow]).toEqual([0])
    expect([...parseCron('5,10 * * * *').minute]).toEqual([5, 10])
  })

  test('bad expressions are rejected', async () => {
    expect(() => parseCron('13 9 * *')).toThrow()
    expect(() => parseCron('61 9 * * *')).toThrow()
    expect(() => parseCron('a 9 * * *')).toThrow()
  })

  test('offset and formatting', async () => {
    expect(parseOffset('+0800\n')).toBe(480)
    expect(parseOffset('-0800')).toBe(-480)
    expect(formatLocal(AT_0913_PST, PST)).toBe('2026-11-11 09:13')
  })
})
