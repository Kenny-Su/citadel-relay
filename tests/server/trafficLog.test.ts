import { describe, expect, it } from 'vitest';
import { createTrafficLogger } from '../../src/relay/trafficLog.js';

describe('traffic logger', () => {
  it('is silent by default and emits structured summary JSON when enabled', () => {
    const lines: string[] = [];
    const off = createTrafficLogger({ level: 'off', write: (line) => lines.push(line) });
    off.log({ event: 'send' }, { secret: true });
    expect(lines).toEqual([]);

    const summary = createTrafficLogger({
      level: 'summary',
      now: () => '2026-01-01T00:00:00.000Z',
      write: (line) => lines.push(line)
    });
    summary.log({ event: 'send', bytes: 42 }, { secret: true });
    expect(JSON.parse(lines[0])).toEqual({
      time: '2026-01-01T00:00:00.000Z',
      component: 'citadel-relay',
      event: 'send',
      bytes: 42
    });
  });

  it('includes payload only at payload level', () => {
    const lines: string[] = [];
    const logger = createTrafficLogger({
      level: 'payload',
      write: (line) => lines.push(line)
    });
    logger.log({ event: 'receive' }, { value: 7 });
    expect(JSON.parse(lines[0]).payload).toEqual({ value: 7 });
  });
});
