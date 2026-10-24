import { fromZonedTime } from 'date-fns-tz';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { combineZonedDateAndTime } from './utils';

const tokyo = 'Asia/Tokyo';

// The calendar hands back midnight of the picked day in the field timezone.
const pickedDay = (day: string, timeZone: string) => fromZonedTime(`${day}T00:00:00`, timeZone);

describe('combineZonedDateAndTime', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps the previous time of day in the field timezone', () => {
    // Jan 5 20:00 in Tokyo
    const prev = '2024-01-05T11:00:00.000Z';

    expect(combineZonedDateAndTime(pickedDay('2024-01-10', tokyo), prev, tokyo)).toBe(
      '2024-01-10T11:00:00.000Z'
    );
  });

  it('keeps the picked day when the time crosses midnight in UTC', () => {
    // Jan 5 08:30 in Tokyo is still Jan 4 in UTC
    const prev = '2024-01-04T23:30:00.000Z';

    expect(combineZonedDateAndTime(pickedDay('2024-01-10', tokyo), prev, tokyo)).toBe(
      '2024-01-09T23:30:00.000Z'
    );
  });

  it('uses the current time in the field timezone when there is no previous value', () => {
    vi.useFakeTimers();
    // 21:15 in New York
    vi.setSystemTime(new Date('2024-03-02T02:15:00.000Z'));
    const newYork = 'America/New_York';

    expect(combineZonedDateAndTime(pickedDay('2024-03-20', newYork), null, newYork)).toBe(
      '2024-03-21T01:15:00.000Z'
    );
  });
});
