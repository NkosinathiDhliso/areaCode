import { Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import type { ServerToClientEvents, ClientToServerEvents } from './types.js';

export type TypedServer = Server<ClientToServerEvents, ServerToClientEvents>;

let io: TypedServer | null = null;

// Valid city slugs — prevents joining arbitrary rooms via citySlug
const VALID_CITY_SLUGS = new Set(['johannesburg', 'cape-town', 'durban']);

/**
 * Validate that a room join request is authorized for this socket.
 * Only allows: city:{validSlug}, node:{uuid}, user:{ownId}, business:{ownId}
 */
function isRoomAllowed(room: string, socket: { data: { userId?: string; businessId?: string } }): boolean {
  if (room.startsWith('city:')) {
    return VALID_CITY_SLUGS.has(room.slice(5));
  }
  if (room.startsWith('node:')) {
    // Node rooms are public — anyone can observe a node
    return room.length > 5;
  }
  if (room.startsWith('user:')) {
    // Users can only join their own user room
    return !!socket.data.userId && room === `user:${socket.data.userId}`;
  }
  if (room.startsWith('business:')) {
    // Business users can only join their own business room
    return !!socket.data.businessId && room === `business:${socket.data.businessId}`;
  }
  return false;
}

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
    const businessId = socket.handshake.auth?.['businessId'] as string | undefined;
    const citySlug = socket.handshake.auth?.['citySlug'] as string | undefined;

    // Store identity on socket for room authorization checks
    socket.data.userId = userId;
    socket.data.businessId = businessId;

    // Join city room (all clients including anonymous) — validated
    if (citySlug && VALID_CITY_SLUGS.has(citySlug)) {
      void socket.join(`city:${citySlug}`);
    }

    // Authenticated clients join their own user room
    if (token && userId) {
      void socket.join(`user:${userId}`);
    }

    // Business clients join their own business room
    if (token && businessId) {
      void socket.join(`business:${businessId}`);
    }

    // Room management events — with authorization
    socket.on('room:join', ({ room }) => {
      if (isRoomAllowed(room, socket)) {
        void socket.join(room);
      }
    });

    socket.on('room:leave', ({ room }) => {
      void socket.leave(room);
    });

    socket.on('presence:join', ({ nodeId }) => {
      if (nodeId) {
        void socket.join(`node:${nodeId}`);
      }
    });

    socket.on('presence:leave', ({ nodeId }) => {
      if (nodeId) {
        void socket.leave(`node:${nodeId}`);
      }
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
