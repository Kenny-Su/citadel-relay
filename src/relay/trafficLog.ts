export type TrafficLogLevel = 'off' | 'summary' | 'payload';

export type TrafficLogger = {
  readonly enabled: boolean;
  log(event: Record<string, unknown>, payload?: unknown): void;
};

export function createTrafficLogger(options: {
  level?: string;
  write?: (line: string) => void;
  now?: () => string;
} = {}): TrafficLogger {
  const level = normalizeLevel(options.level ?? process.env.RELAY_TRAFFIC_LOG);
  const write = options.write ?? console.log;
  const now = options.now ?? (() => new Date().toISOString());

  return {
    enabled: level !== 'off',
    log(event, payload) {
      if (level === 'off') return;
      write(JSON.stringify({
        time: now(),
        component: 'citadel-relay',
        ...event,
        ...(level === 'payload' && payload !== undefined ? { payload } : {})
      }));
    }
  };
}

function normalizeLevel(value: string | undefined): TrafficLogLevel {
  return value === 'summary' || value === 'payload' ? value : 'off';
}
