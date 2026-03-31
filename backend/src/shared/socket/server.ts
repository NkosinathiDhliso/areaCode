import { Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import type { ServerToClientEvents, ClientToServerEvents } from './types.js';

export type TypedServer = Server<ClientToServerEvents, ServerToClientEvents>;

let io: TypedServer | null = null;

/**
 * Initialise Socket.io server with JWT auth at handshake.
 * Token is optional — anonymous clients join city rooms only.
 */
export function initSocketServer(httpServer: HttpServer): TypedServer {
  if (io) return io;

  const isProd = process.env['AREA_CODE_ENV'] === 'prod';

  io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
    cors: {
      origin: isProd
        ? [
            'https://areacode.co.za',
            'https://business.areacode.co.za',
            'https://staff.areacode.co.za',
            'https://admin.areacode.co.za',
          ]
        : [
            'http://localhost:3000',
            'http://localhost:3001',
            'http://localhost:3002',
            'http://localhost:3003',
          ],
      credentials: true,
    },
    transports: ['websocket'],
    pingInterval: 25000,
    pingTimeout: 20000,
  });

  // Connection handler
  io.on('connection', (socket) => {
    const token = socket.handshake.auth?.['token'] as string | undefined;
    const userId = socket.handshake.auth?.['userId'] as string | undefined;
    const citySlug = socket.handshake.auth?.['citySlug'] as string | undefined;

    // Join city room (all clients including anonymous)
    if (citySlug) {
      void socket.join(`city:${citySlug}`);
    }

    // Authenticated clients join user room
    if (token && userId) {
      void socket.join(`user:${userId}`);
    }

    // Room management events
    socket.on('room:join', ({ room }) => {
      void socket.join(room);
    });

    socket.on('room:leave', ({ room }) => {
      void socket.leave(room);
    });

    socket.on('presence:join', ({ nodeId }) => {
      void socket.join(`node:${nodeId}`);
    });

    socket.on('presence:leave', ({ nodeId }) => {
      void socket.leave(`node:${nodeId}`);
    });

    socket.on('disconnect', () => {
      // Cleanup handled by Socket.io automatically
    });
  });

  return io;
}

export function getIO(): TypedServer {
  if (!io) {
    throw new Error('Socket.io server not initialised. Call initSocketServer first.');
  }
  return io;
}
