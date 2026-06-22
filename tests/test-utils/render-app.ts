import { vi } from 'vitest';

const mockSocket = vi.hoisted(() => ({
  connected: false,
  connect: vi.fn(),
  disconnect: vi.fn(),
  emit: vi.fn(),
  off: vi.fn(),
  on: vi.fn()
}));

vi.mock('socket.io-client', () => {
  return {
    io: () => mockSocket
  };
});

export function getMockSocket() {
  return mockSocket;
}
