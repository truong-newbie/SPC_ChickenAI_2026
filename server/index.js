import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const httpServer = createServer(app);

const io = new Server(httpServer, {
  cors: {
    origin: process.env.CLIENT_URL || '*',
    methods: ['GET', 'POST'],
  },
});

app.use(cors());
app.use(express.json());

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Room management
const rooms = new Map();

// Socket.IO signaling
io.on('connection', (socket) => {
  console.log(`Client connected: ${socket.id}`);

  // Create a room
  socket.on('create-room', (data, callback) => {
    const { roomCode } = data;

    if (rooms.has(roomCode)) {
      callback({ success: false, error: 'Room already exists' });
      return;
    }

    rooms.set(roomCode, {
      host: socket.id,
      clients: [socket.id],
      createdAt: Date.now(),
    });

    socket.join(roomCode);
    socket.data.roomCode = roomCode;

    console.log(`Room created: ${roomCode} by ${socket.id}`);
    callback({ success: true, roomCode });
  });

  // Join a room
  socket.on('join-room', (data, callback) => {
    const { roomCode } = data;
    const room = rooms.get(roomCode);

    if (!room) {
      callback({ success: false, error: 'Room not found' });
      return;
    }

    // Check if room is full (max 2 clients: host + 1 peer)
    if (room.clients.length >= 2) {
      callback({ success: false, error: 'Room is full' });
      return;
    }

    room.clients.push(socket.id);
    socket.join(roomCode);
    socket.data.roomCode = roomCode;

    // Notify host about new peer
    io.to(room.host).emit('peer-joined', { peerId: socket.id });

    console.log(`Client ${socket.id} joined room: ${roomCode}`);
    callback({ success: true, roomCode, isHost: false });
  });

  // WebRTC signaling: send offer
  socket.on('offer', (data) => {
    const { targetId, offer } = data;
    io.to(targetId).emit('offer', {
      offer,
      fromId: socket.id,
    });
  });

  // WebRTC signaling: send answer
  socket.on('answer', (data) => {
    const { targetId, answer } = data;
    io.to(targetId).emit('answer', {
      answer,
      fromId: socket.id,
    });
  });

  // WebRTC signaling: ICE candidate
  socket.on('ice-candidate', (data) => {
    const { targetId, candidate } = data;
    io.to(targetId).emit('ice-candidate', {
      candidate,
      fromId: socket.id,
    });
  });

  // Get room info
  socket.on('get-room-info', (data, callback) => {
    const { roomCode } = data;
    const room = rooms.get(roomCode);

    if (!room) {
      callback({ success: false, error: 'Room not found' });
      return;
    }

    callback({
      success: true,
      roomInfo: {
        roomCode,
        clientCount: room.clients.length,
        isFull: room.clients.length >= 2,
      },
    });
  });

  // Disconnect handling
  socket.on('disconnect', () => {
    const roomCode = socket.data.roomCode;

    if (roomCode && rooms.has(roomCode)) {
      const room = rooms.get(roomCode);
      room.clients = room.clients.filter((id) => id !== socket.id);

      // Notify remaining peers
      io.to(roomCode).emit('peer-disconnected', { peerId: socket.id });

      // Clean up empty rooms after a delay
      if (room.clients.length === 0) {
        setTimeout(() => {
          const currentRoom = rooms.get(roomCode);
          if (currentRoom && currentRoom.clients.length === 0) {
            rooms.delete(roomCode);
            console.log(`Room deleted: ${roomCode}`);
          }
        }, 60000); // Keep room for 1 minute for reconnection
      }
    }

    console.log(`Client disconnected: ${socket.id}`);
  });
});

const PORT = process.env.PORT || 3001;

httpServer.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════════════════╗
║     FileBridge Signaling Server                    ║
║     Running on http://localhost:${PORT}               ║
╚════════════════════════════════════════════════════╝
  `);
});
