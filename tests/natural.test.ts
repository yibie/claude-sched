import { describe, expect, test } from 'claude-code/testing'
import { interpretReply, leadingCron } from '../hooks/natural.ts'

describe('leadingCron', () => {
  test('quoted and bare cron are taken directly', async () => {
    expect(leadingCron('"13 9 * * *" run the monitor')).toEqual({ cron: '13 9 * * *', prompt: 'run the monitor' })
    expect(leadingCron('0 */2 * * * check build')).toEqual({ cron: '0 */2 * * *', prompt: 'check build' })
  })

  test('plain language is not mistaken for cron', async () => {
    expect(leadingCron('every day at 9am run the monitor')).toBeUndefined()
    expect(leadingCron('每天早上9点13分 跑游戏监控')).toBeUndefined()
    expect(leadingCron('"every weekday 9am" check build')).toBeUndefined()
  })
})

describe('interpretReply', () => {
  test('time phrase first: prompt is the rest, verbatim', async () => {
    const input = '每天早上9点13分，跑游戏监控并汇报（不要部署）'
    const r = interpretReply(
      '{"schedule":"每天早上9点13分","cron":"13 9 * * *","once":false,"summary":"every day at 09:13"}',
      input,
    )
    expect(r).toEqual({
      ok: true,
      cron: '13 9 * * *',
      prompt: '跑游戏监控并汇报（不要部署）',
      once: false,
      summary: 'every day at 09:13',
      schedule: '每天早上9点13分',
    })
  })

  test('time phrase last, reply wrapped in prose', async () => {
    const r = interpretReply(
      'Here you go: {"schedule":"every weekday at 9am","cron":"0 9 * * 1-5","once":false,"summary":"weekdays 09:00"}',
      'check the build status, every weekday at 9am',
    )
    expect(r.ok && r.prompt).toBe('check the build status')
    expect(r.ok && r.cron).toBe('0 9 * * 1-5')
  })

  test('one-time schedule', async () => {
    const r = interpretReply(
      '{"schedule":"tomorrow at 3pm","cron":"0 15 13 11 *","once":true,"summary":"Nov 13 at 15:00"}',
      'tomorrow at 3pm retry the HD lip-sync test',
    )
    expect(r.ok && r.once).toBe(true)
  })

  test('rejects what does not check out', async () => {
    expect(interpretReply('{"error":"no time given"}', 'run it').ok).toBe(false)
    expect(interpretReply('not json', 'daily run it').ok).toBe(false)
    // time phrase the input does not contain
    expect(interpretReply('{"schedule":"every day","cron":"0 9 * * *"}', 'daily run it').ok).toBe(false)
    // invalid cron
    expect(interpretReply('{"schedule":"daily","cron":"0 25 * * *"}', 'daily run it').ok).toBe(false)
    // nothing left after the time phrase
    expect(interpretReply('{"schedule":"daily at 9","cron":"0 9 * * *"}', 'daily at 9').ok).toBe(false)
  })
})
