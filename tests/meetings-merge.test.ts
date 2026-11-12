import { describe, expect, it } from 'vitest'
import { meetingKey, mergeMeetings, meetingSeconds } from '../src/shared/meetings'
import type { Meeting } from '../src/shared/types'

const meeting = (
  id: number,
  start: string,
  end: string | null,
  url: string | null,
  title: string | null = 'Google Meet'
): Meeting => ({ id, tsStart: start, tsEnd: end, url, title })

const t = (h: number, m = 0): string => new Date(2026, 10, 12, h, m).toISOString()

describe('meetingKey', () => {
  it('считает одним созвоном разные формы ссылки', () => {
    const a = meeting(1, t(13), t(14), 'https://meet.google.com/cqu-vfcz-ftv?authuser=a%40b.c')
    const b = meeting(2, t(13), t(14), 'https://meet.google.com/meet/cqu-vfcz-ftv?authuser=a@b.c')
    expect(meetingKey(a)).toBe(meetingKey(b))
  })

  it('разные комнаты — разные ключи', () => {
    expect(meetingKey(meeting(1, t(13), t(14), 'https://meet.google.com/aaa-bbbb-ccc'))).not.toBe(
      meetingKey(meeting(2, t(13), t(14), 'https://meet.google.com/xxx-yyyy-zzz'))
    )
  })
})

describe('mergeMeetings', () => {
  it('склеивает один звонок, разорванный перезапуском или разными формами ссылки', () => {
    const merged = mergeMeetings([
      meeting(1, t(13, 0), t(13, 5), 'https://meet.google.com/cqu-vfcz-ftv'),
      meeting(2, t(13, 5), t(13, 20), 'https://meet.google.com/meet/cqu-vfcz-ftv?authuser=a@b.c'),
      meeting(3, t(13, 25), t(13, 40), null) // поймали по заголовку, без ссылки
    ])
    expect(merged).toHaveLength(1)
    expect(meetingSeconds(merged[0])).toBe(40 * 60)
  })

  it('не склеивает Meet и хаддл подряд', () => {
    const merged = mergeMeetings([
      meeting(1, t(15, 0), t(15, 20), 'https://meet.google.com/aaa-bbbb-ccc', 'Google Meet'),
      meeting(2, t(15, 22), t(15, 50), null, 'Slack huddle')
    ])
    expect(merged).toHaveLength(2)
  })

  it('не склеивает разные звонки рядом', () => {
    const merged = mergeMeetings([
      meeting(1, t(10, 0), t(10, 30), 'https://meet.google.com/aaa-bbbb-ccc'),
      meeting(2, t(10, 35), t(11, 0), 'https://meet.google.com/xxx-yyyy-zzz')
    ])
    expect(merged).toHaveLength(2)
  })

  it('склеивает звонок с разрывом до 20 минут (сигнал теряется, звонок нет)', () => {
    const merged = mergeMeetings([
      meeting(1, t(13, 0), t(13, 20), 'https://meet.google.com/cqu-vfcz-ftv'),
      meeting(2, t(13, 40), t(13, 50), 'https://meet.google.com/cqu-vfcz-ftv')
    ])
    expect(merged).toHaveLength(1)
  })

  it('не склеивает звонки с большим разрывом', () => {
    const merged = mergeMeetings([
      meeting(1, t(13, 0), t(13, 20), 'https://meet.google.com/cqu-vfcz-ftv'),
      meeting(2, t(14, 30), t(14, 50), 'https://meet.google.com/cqu-vfcz-ftv')
    ])
    expect(merged).toHaveLength(2)
  })

  it('склеивает хаддлы Slack без ссылки', () => {
    const merged = mergeMeetings([
      meeting(1, t(15, 0), t(15, 20), null, 'Slack huddle'),
      meeting(2, t(15, 22), t(15, 50), null, 'Slack huddle')
    ])
    expect(merged).toHaveLength(1)
  })
})
