/**
 * Bounded HTTP-server teardown.
 *
 * `server.close()` waits for every existing connection, including idle
 * keep-alive sockets. A shutdown that only awaits it stalls until the
 * process is killed — the exact outcome the graceful SIGINT path exists
 * to avoid.
 *
 * An integration suite because the behaviour only exists against a real
 * listener holding a real socket; a fake `Server` cannot demonstrate
 * that `closeAllConnections` is what unblocks the close.
 */
import { createServer, type Server } from 'node:http';
import { connect } from 'node:net';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { closeServerBounded } from '../../../../src/core/http';

const listenOnEphemeralPort = async (server: Server): Promise<number> => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('no TCP address');
  return address.port;
};

let servers: Server[] = [];

afterEach(() => {
  for (const s of servers) s.close();
  servers = [];
});

describe('closeServerBounded', () => {
  it('closes a server with no connections', async () => {
    const server = createServer((_req, res) => res.end('ok'));
    servers.push(server);
    await listenOnEphemeralPort(server);

    await closeServerBounded(server);

    expect(server.listening).toBe(false);
  });

  it('closes despite an idle keep-alive connection', async () => {
    const server = createServer((_req, res) => res.end('ok'));
    servers.push(server);
    const port = await listenOnEphemeralPort(server);

    // Hold a socket open without sending a request — the shape of an
    // idle keep-alive client. A plain `close()` would wait for it.
    const socket = connect(port, '127.0.0.1');
    await new Promise<void>((resolve) => socket.on('connect', () => resolve()));

    const onTimeout = vi.fn();
    await closeServerBounded(server, onTimeout);

    expect(server.listening).toBe(false);
    expect(onTimeout).not.toHaveBeenCalled();
    socket.destroy();
  });

  it('reports and resolves when the server refuses to close in time', async () => {
    const onTimeout = vi.fn();
    // A stub whose `close` callback never fires models a server wedged
    // on something the teardown cannot influence.
    const wedged = {
      closeAllConnections: vi.fn(),
      close: vi.fn(),
    } as unknown as Server;

    vi.useFakeTimers();
    const closing = closeServerBounded(wedged, onTimeout);
    await vi.advanceTimersByTimeAsync(3_000);
    await expect(closing).resolves.toBeUndefined();
    vi.useRealTimers();

    expect(onTimeout).toHaveBeenCalledTimes(1);
  });
});
