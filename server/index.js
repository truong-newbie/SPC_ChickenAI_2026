/**
 * FileBridge Signaling Server
 * Based on Floe's signaling architecture
 *
 * Features:
 * - Socket.IO for browser clients
 * - Room management with sender/receiver roles
 * - WebRTC signal relay
 * - Rate limiting
 */

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
const httpServer = http.createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
  maxHttpBufferSize: 1e6,
});

app.use(cors());
app.use(express.json());

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    rooms: rooms.size,
    connections: io.engine.clientsCount,
  });
});

// In-memory room storage: roomId -> [sender, receiver]
const rooms = new Map();

// Generate UUID v4
function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

// Rate limiting
const connectionCounts = new Map();
const RATE_LIMIT_WINDOW = 60000;
const MAX_CONNECTIONS_PER_IP = 30;

function checkRateLimit(ip) {
  const now = Date.now();
  const timestamps = (connectionCounts.get(ip) || []).filter(t => now - t < RATE_LIMIT_WINDOW);
  if (timestamps.length >= MAX_CONNECTIONS_PER_IP) {
    return false;
  }
  timestamps.push(now);
  connectionCounts.set(ip, timestamps);
  return true;
}

// Cleanup old rate limit entries periodically
setInterval(() => {
  const now = Date.now();
  for (const [ip, timestamps] of connectionCounts.entries()) {
    const valid = timestamps.filter(t => now - t < RATE_LIMIT_WINDOW);
    if (valid.length === 0) {
      connectionCounts.delete(ip);
    } else {
      connectionCounts.set(ip, valid);
    }
  }
  // Cleanup empty rooms
  for (const [roomId, peers] of rooms.entries()) {
    if (peers.length === 0 || peers.every(p => !p.connected)) {
      rooms.delete(roomId);
    }
  }
}, 60000).unref();

// ============================================================================
// Socket.IO signaling
// ============================================================================

io.on('connection', (socket) => {
  const ip = socket.handshake.address || socket.handshake.headers['x-forwarded-for'] || 'unknown';

  if (!checkRateLimit(ip)) {
    socket.emit('error', { message: 'Too many connections from this IP' });
    socket.disconnect();
    return;
  }

  console.log(`[SERVER] Client connected: ${socket.id}`);

  // Handle join room
  socket.on('join-room', (data) => {
    let roomCode;

    // data can be:
    // - null/undefined: sender creating new room
    // - string: room code to join
    // - { roomCode }: room code object
    if (!data) {
      // Sender creating new room - generate code
      roomCode = generateRoomCode();
    } else if (typeof data === 'string') {
      roomCode = data;
    } else if (typeof data === 'object' && data.roomCode) {
      roomCode = data.roomCode;
    } else {
      socket.emit('error', { message: 'Invalid join-room request' });
      return;
    }

    console.log(`[SERVER] ← ${socket.id} join-room: ${roomCode}`);

    // Get or create room
    let room = rooms.get(roomCode);

    if (!room) {
      // First peer - becomes sender
      room = [];
      rooms.set(roomCode, room);
    }

    if (room.length >= 2) {
      socket.emit('room-full', {});
      console.log(`[SERVER] → ${socket.id} room-full`);
      return;
    }

    // Add peer to room
    room.push(socket);
    socket.roomCode = roomCode;
    socket.isSender = room.length === 1;

    // Send role to joining peer
    socket.emit('room-joined', {
      roomCode,
      role: socket.isSender ? 'sender' : 'receiver',
    });
    console.log(`[SERVER] → ${socket.id} room-joined (role: ${socket.isSender ? 'sender' : 'receiver'})`);

    // Notify sender that receiver joined
    if (!socket.isSender && room[0]) {
      room[0].emit('user-connected', { id: socket.id });
      console.log(`[SERVER] → ${room[0].id} user-connected`);
    }
  });

  // Handle signal relay (WebRTC SDP/ICE)
  socket.on('signal', (data) => {
    if (!socket.roomCode) {
      console.log(`[SERVER] ${socket.id} tried to signal without a room`);
      return;
    }

    const room = rooms.get(socket.roomCode);
    if (!room) return;

    // Find the other peer
    const target = room.find(p => p.id !== socket.id);
    if (!target) return;

    console.log(`[SERVER] ${socket.id} → signal → ${target.id}`);
    target.emit('signal', {
      signal: data.signal || data,
      sender: socket.id,
    });
  });

  // Handle disconnect
  socket.on('disconnect', (reason) => {
    console.log(`[SERVER] Client disconnected: ${socket.id} (${reason})`);

    if (socket.roomCode) {
      const room = rooms.get(socket.roomCode);
      if (room) {
        // Remove from room
        const index = room.indexOf(socket);
        if (index > -1) {
          room.splice(index, 1);
        }

        // Notify remaining peer
        if (room.length === 1 && room[0]) {
          room[0].emit('peer-disconnected', {});
          console.log(`[SERVER] → ${room[0].id} peer-disconnected`);
        }

        // Delete empty room
        if (room.length === 0) {
          rooms.delete(socket.roomCode);
        }
      }
    }
  });
});

// ============================================================================
// Start server
// ============================================================================

const PORT = process.env.PORT || 3002;

httpServer.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════════════════════╗
║          FileBridge Signaling Server (Floe-style)     ║
║  Status: Running                                      ║
║  Port: ${PORT}                                            ║
║  WebSocket: Socket.IO                                 ║
║  Protocol: WebRTC signaling relay                     ║
╚════════════════════════════════════════════════════════╝
  `);
});
