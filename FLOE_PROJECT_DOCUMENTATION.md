# Floe - P2P File Transfer Platform Documentation

## Table of Contents
1. [Project Overview](#1-project-overview)
2. [System Architecture](#2-system-architecture)
3. [Installation & Setup](#3-installation--setup)
4. [Server Components](#4-server-components)
5. [Client Components](#5-client-components)
6. [WebRTC Transfer Protocol](#6-webrtc-transfer-protocol)
7. [API Endpoints](#7-api-endpoints)
8. [Configuration](#8-configuration)
9. [Docker Deployment](#9-docker-deployment)
10. [Implementation Checklist](#10-implementation-checklist)

---

## 1. Project Overview

**Floe** is an encrypted, peer-to-peer (P2P) file transfer application built on WebRTC. The application allows users to transfer files directly between browsers without uploading them to any server.

### Key Features
- End-to-end encrypted file transfer via WebRTC Data Channels
- No file storage on servers (server only handles signaling)
- Three client types: Web browser, Desktop app (Wails), CLI (Go)
- Optional TURN relay for restrictive networks (2 GB limit)
- Global anonymous stats counter (opt-out available)
- No accounts, no registration required

### Project Structure
```
floe/
├── client/              # Next.js 16 web application (React 19)
│   ├── app/             # Next.js App Router pages
│   ├── components/      # React components
│   ├── hooks/           # Custom React hooks
│   └── lib/             # Pure utility modules + transfer protocol
├── server/              # Node.js signaling server
│   ├── server.js        # Main Express + Socket.IO + WebSocket server
│   ├── turn.js          # TURN credential generation
│   ├── stats.js         # Global stats counter
│   ├── ratekey.js       # IP-based rate limiting
│   └── words.json       # Word list for room codes
├── cli/                 # Go CLI application
├── desktop/             # Wails desktop application
└── docker-compose.yml   # Self-hosting deployment
```

---

## 2. System Architecture

### High-Level Flow

```
┌─────────────┐         ┌─────────────────┐         ┌─────────────┐
│   Sender    │◄───────►│   Signaling     │◄───────►│  Receiver   │
│   Browser   │ WebRTC  │    Server       │  WebRTC │   Browser   │
│  (Client)   │ Signaling│  (Socket.IO)   │ Signaling│  (Client)   │
└─────────────┘         └─────────────────┘         └─────────────┘
       │                         │                          │
       │   ┌────────────────────┴────────────────────┐   │
       │   │           WebRTC Data Channel            │   │
       │   │  (Direct P2P connection - no server)    │   │
       │   └──────────────────────────────────────────┘   │
       │                                                  │
       └──────────────────────────────────────────────────┘
                    File Data Transfer
```

### Room & Signaling Flow

1. **Sender joins room** → Server assigns role "sender" → Server confirms with `room-joined` event
2. **Receiver joins room** → Server assigns role "receiver" → Server notifies sender via `user-connected`
3. **WebRTC negotiation** → Peers exchange signals (offer/answer/ICE) via server
4. **Direct connection established** → File transfer happens via WebRTC Data Channel (server not involved)
5. **Transfer complete** → Receiver optionally reports bytes to `/api/stats/report`

### Security Architecture

| Layer | Technology | Purpose |
|-------|------------|---------|
| Transport | WebRTC DTLS | Peer-to-peer encryption |
| Signaling | HTTPS/WSS | Secure signaling channel |
| Rate Limiting | Per-IP limits | DDoS protection |
| Relay | TURN with TLS | Encrypted relay fallback |
| Room IDs | UUID v4 | Unpredictable room identifiers |
| Room Secret | URL Fragment | Never sent to server |

---

## 3. Installation & Setup

### Prerequisites
- Node.js 18+
- pnpm (for client)
- Go 1.21+ (for CLI/desktop)

### Step 1: Clone Repository
```bash
git clone https://github.com/jannskiee/floe.git
cd floe
```

### Step 2: Server Setup
```bash
cd server

# Install dependencies
npm install

# Copy environment file
cp .env.example .env

# Start development server
npm run dev
# Server runs on http://localhost:3001
```

### Step 3: Client Setup
```bash
cd client

# Install dependencies (requires pnpm)
pnpm install

# Copy environment file
cp .env.example .env.local

# Start development server
pnpm dev
# Client runs on http://localhost:3000
```

### Step 4: Verify Setup
1. Open http://localhost:3000 in browser
2. Select a file to send
3. Click "Create secure link"
4. Open link in another browser/tab
5. Confirm file transfer works

---

## 4. Server Components

### 4.1 Main Server (`server/server.js`)

**Responsibilities:**
- HTTP server with Express
- Socket.IO for browser WebSocket connections
- Native WebSocket server for CLI clients
- Room management (Map<roomId, [peer, peer]>)
- Rate limiting
- Error handling

**Key Features:**

#### CORS Configuration
```javascript
const allowedOrigins = [
    process.env.CLIENT_URL,
    'https://www.floe.one',
    'https://floe.one',
    'http://localhost:3000',
];
```

#### Room Management
```javascript
const rooms = new Map(); // roomId → [peer, peer]

function handleJoinRoom(peer, roomId) {
    const room = rooms.get(roomId) || [];
    
    if (room.length === 0) {
        // First peer = SENDER
        room.push(peer);
        rooms.set(roomId, room);
        peer.roomId = roomId;
        peer.send('room-joined', { role: 'sender' });
    } else if (room.length === 1) {
        // Second peer = RECEIVER
        room.push(peer);
        rooms.set(roomId, room);
        peer.roomId = roomId;
        peer.send('room-joined', { role: 'receiver' });
        room[0].send('user-connected', { id: peer.id });
    } else {
        peer.send('room-full', {});
    }
}
```

#### WebSocket Handling
- Socket.IO: Browser clients (`/socket.io/`)
- Native WebSocket: CLI clients (`/ws`)
- Both share the same `rooms` registry

#### Rate Limiting
- **Connection limit**: 30 per IP per 60s
- **TURN endpoint**: 20 requests per IP per 60s
- **Stats endpoint**: 60 reports per IP per 60s
- **Code endpoint**: 60 requests per IP per 60s

### 4.2 TURN Credential Generation (`server/turn.js`)

**Priority Order:**
1. **Cloudflare Realtime TURN** (if `CLOUDFLARE_TURN_KEY_ID` + `CLOUDFLARE_TURN_KEY_API_TOKEN` set)
2. **Self-hosted coturn** (if `TURN_SECRET` + `TURN_DOMAIN` set)
3. **Google STUN only** (fallback)

**Key Functions:**

```javascript
// Generate coturn credentials (24h TTL)
function generateCoturnCredentials() {
    const ttl = 24 * 3600;
    const expiry = Math.floor(Date.now() / 1000) + ttl;
    const username = `${expiry}:floeuser`;
    const password = crypto.createHmac('sha1', turnSecret)
        .update(username)
        .digest('base64');
    return [
        { urls: `stun:${turnDomain}:3478` },
        { urls: `turn:${turnDomain}:3478`, username, credential: password },
        { urls: `turns:${turnDomain}:5349`, username, credential: password },
    ];
}

// Cloudflare TURN API integration
async function generateCloudflareIceServers() {
    const resp = await fetch(
        `https://rtc.live.cloudflare.com/v1/turn/keys/${KEY_ID}/credentials/generate-ice-servers`,
        {
            method: 'POST',
            headers: { Authorization: `Bearer ${API_TOKEN}` },
            body: JSON.stringify({ ttl: 86400 }),
        }
    );
    return resp.json().iceServers;
}
```

### 4.3 Global Stats Counter (`server/stats.js`)

**Endpoints:**
- `GET /api/stats` - Return current total bytes
- `POST /api/stats/report` - Increment counter

**Implementation:**
```javascript
let cachedTotal = 0;

async function upstashPost(command) {
    // Upstash Redis REST API
    const resp = await fetch(UPSTASH_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` },
        body: JSON.stringify(command),
    });
    return resp.json().result;
}

async function initStats() {
    // Seed cache from Redis on startup
    cachedTotal = await upstashPost(['GET', 'floe:bytes_total']);
}
```

### 4.4 Rate Key Generation (`server/ratekey.js`)

```javascript
function rateKey(ip) {
    // Handle IPv6 by /64 prefix
    if (ip.includes(':')) {
        return ip.replace(/^([\w:]+::[\da-f]{2})[\da-f]*$/i, '$1');
    }
    // Unwrap IPv4-mapped IPv6
    if (ip.startsWith('::ffff:')) {
        return ip.slice(7);
    }
    return ip;
}
```

---

## 5. Client Components

### 5.1 Main Transfer Component (`client/components/P2PTransfer.tsx`)

**State Management:**
```typescript
interface TransferState {
    isSender: boolean | null;      // Auto-detected from URL
    status: string;                // Current status message
    generatedLink: string;         // Shareable transfer link
    files: FileWithId[];           // Selected files
    progress: number;              // 0-100 percentage
    receivedFiles: ReceivedFile[]; // Downloaded files
    error: string;                // Error message
    transferSpeed: string;         // "2.5 MB/s"
    estimatedTime: string;         // "2m 30s"
}
```

**Sender Flow:**
1. User selects files (drag-drop or browse)
2. User clicks "Create secure link"
3. System generates UUID room ID
4. System connects to signaling server
5. System waits for receiver connection
6. WebRTC connection established
7. Files transferred via Data Channel

**Receiver Flow:**
1. User opens transfer link
2. URL contains room ID in fragment (`#room=<uuid>`)
3. System connects to signaling server
4. System joins room
5. WebRTC connection established
6. Files received via Data Channel

### 5.2 Signaling Hook (`client/hooks/useSignaling.ts`)

**Responsibilities:**
- Socket.IO connection management
- Room joining
- Signal relay (WebRTC offer/answer/ICE)
- Connection status monitoring

**Key Features:**
```typescript
// Singleton socket (shared across app)
let socketPromise: Promise<Socket> | null = null;

function getSocket(): Promise<Socket> {
    if (!socketPromise) {
        socketPromise = resolveSocketUrl().then(url =>
            io(url, {
                reconnectionDelay: 500,
                reconnectionDelayMax: 3000,
            })
        );
    }
    return socketPromise;
}

// Exports
const joinRoom = useCallback((roomId: string) => {
    void getSocket().then(s => s.emit('join-room', roomId));
}, []);

const sendSignal = useCallback((payload: SignalPayload) => {
    void getSocket().then(s => s.emit('signal', payload));
}, []);
```

### 5.3 File Management Hook (`client/hooks/useFileManagement.ts`)

**Responsibilities:**
- File selection via input or drag-drop
- File list management (add/delete)
- Total byte calculation

```typescript
interface FileWithId {
    id: string;  // UUID v4
    file: File;   // Browser File object
}

export function useFileManagement() {
    const [files, setFiles] = useState<FileWithId[]>([]);
    const totalBytes = files.reduce((sum, f) => sum + f.file.size, 0);
    
    const addFiles = (incoming: FileList) => {
        const mapped = Array.from(incoming).map(file => ({
            id: uuidv4(),
            file,
        }));
        setFiles(prev => [...prev, ...mapped]);
    };
    // ... drag-drop handlers
}
```

### 5.4 Relay Configuration Hook (`client/hooks/useRelayConfiguration.ts`)

**Purpose:** Toggle TURN relay fallback

```typescript
export function useRelayConfiguration() {
    const [relayEnabled, setRelayEnabled] = useState(true);
    return { relayEnabled, setRelayEnabled };
}
```

### 5.5 Connection Type Detection (`client/hooks/useConnectionType.ts`)

**Purpose:** Detect if WebRTC uses direct or relay connection

```typescript
export function useConnectionType() {
    const [connectionType, setConnectionType] = useState<'direct' | 'relay' | null>(null);
    
    // Poll every 5 seconds
    const startPolling = (peer: PeerInstance) => {
        const check = async () => {
            const pc = (peer as any)._pc as RTCPeerConnection;
            const stats = await pc.getStats();
            setConnectionType(readConnectionType(stats));
        };
        check();
        setInterval(check, 5000);
    };
}
```

---

## 6. WebRTC Transfer Protocol

### 6.1 Protocol Constants (`client/lib/transfer/protocol.ts`)

```typescript
// Flow Control
export const HIGH_WATER = 8 * 1024 * 1024;  // Pause at 8 MB
export const LOW_WATER = 4 * 1024 * 1024;   // Resume at 4 MB

// File Reading
export const READ_SLAB = 4 * 1024 * 1024;    // Read 4 MB chunks

// Chunk Size
export const DEFAULT_CHUNK = 64 * 1024;       // Default 64 KB
export const MAX_CHUNK = 256 * 1024;         // Max 256 KB

// Protocol Version (must match Go implementation)
export const PROTOCOL_VERSION = 1;
export const MIN_PROTOCOL_VERSION = 1;

// Timeouts
export const ACK_TIMEOUT_MS = 120_000;        // 2 min for receiver ack
export const CONTROL_FLUSH_MS = 2000;         // 2s for abort reason
```

### 6.2 Message Types

```typescript
// Metadata (sender → receiver)
interface Metadata {
    type: 'metadata';
    id: string;           // File UUID
    fileName: string;
    fileSize: number;
    index: number;        // 1-based file index
    total: number;        // Total files
    totalBytes: number;   // Total transfer bytes
    pv?: number;          // Protocol version
    pvMin?: number;       // Min protocol version
    ver?: string;         // Release version
}

// Ack (receiver → sender)
interface Ack {
    type: 'ack';
    id: string;
    offset: number;       // Resume offset (0 for new)
    pv?: number;
    pvMin?: number;
    ver?: string;
}

// End marker
interface End {
    type: 'end';
}

// Incompatible (either → other)
interface Incompatible {
    type: 'incompatible';
    reason: string;
    pv?: number;
    pvMin?: number;
    ver?: string;
}
```

### 6.3 Sender Implementation (`client/lib/transfer/sender.ts`)

**Key Algorithm:**
```typescript
async function sendSingleFile(deps, entry, index, total, totalBytes, cb, view) {
    // 1. Drain previous file's buffer
    await drainBelow(channel, 64 * 1024);
    
    // 2. Send metadata
    send(metadataMessage(id, file.name, file.size, index, total, totalBytes));
    
    // 3. Wait for ack (120s timeout)
    const ack = await waitForAck(onData, id);
    if (ack.type === 'timeout') return false;
    if (ack.type === 'incompatible') {
        cb.onError(compatErrorFromIncompatible(ack));
        return false;
    }
    
    // 4. Send file chunks
    while (offset < file.size) {
        if (channel.bufferedAmount >= HIGH_WATER) {
            await waitForBuffer();  // Backpressure
        }
        const chunk = await file.slice(offset, offset + CHUNK_SIZE).arrayBuffer();
        send(chunk);
        offset += chunk.byteLength;
    }
    
    // 5. Send end marker
    send(endMessage());
    return true;
}
```

### 6.4 Receiver Implementation (`client/lib/transfer/receiver.ts`)

**Key Algorithm:**
```typescript
function createReceiver(cb) {
    const partialDownloads = new Map();
    
    function handleMessage(data) {
        // Framing determines type, not content
        if (isControlFrame(data)) {
            const msg = classifyControl(data);
            
            if (msg.type === 'metadata') {
                // Send ack with resume offset
                cb.send(ackMessage(msg.id, offset));
            } else if (msg.type === 'end') {
                // Verify integrity
                if (expectedSize !== null && received !== expectedSize) {
                    cb.onError('Incomplete file');
                    return;
                }
                // Create blob and deliver
                const blob = new Blob(chunks);
                cb.onFileComplete({ id, fileName, fileSize, blob });
            }
        } else {
            // Binary: file data
            chunks.push(data);
            received += data.byteLength;
        }
    }
    
    return { handleMessage };
}
```

### 6.5 Relay Size Limit

**Client Side (`client/lib/relay.ts`):**
```typescript
export const RELAY_SIZE_LIMIT = 2 * 1024 * 1024 * 1024; // 2 GB

export function evaluateRelayGate({ isRelay, relayEnabled, totalSize }) {
    if (isRelay && !relayEnabled) {
        return { action: 'block-relay-disabled' };
    }
    if (isRelay && totalSize > RELAY_SIZE_LIMIT) {
        return { action: 'block-over-limit', totalSize };
    }
    return { action: 'proceed' };
}
```

---

## 7. API Endpoints

### 7.1 TURN Credentials

```
GET /api/turn-credentials
```

**Response:**
```json
[
    { "urls": ["stun:stun.l.google.com:19302"] },
    { "urls": ["stun:stun1.l.google.com:19302"] },
    {
        "urls": ["turn:turn.example.com:3478"],
        "username": "1234567890:floeuser",
        "credential": "base64-encoded-password"
    }
]
```

### 7.2 Global Stats

```
GET /api/stats
```

**Response:**
```json
{ "totalBytes": 1234567890 }
```

### 7.3 Report Stats (Receiver Only)

```
POST /api/stats/report
Content-Type: application/json

{ "bytes": 1048576 }
```

**Response:**
```json
{ "totalBytes": 1234578746 }
```

### 7.4 Create Room Code (CLI)

```
POST /api/code
Content-Type: application/json

{ "roomId": "30cc0128-a43b-4c07-83c3-19244210d371" }
```

**Response:**
```json
{ "code": "olive-tiger-castle" }
```

### 7.5 Resolve Room Code (CLI)

```
GET /api/code/olive-tiger-castle
```

**Response:**
```json
{ "roomId": "30cc0128-a43b-4c07-83c3-19244210d371" }
```

### 7.6 Socket.IO Events

**Client → Server:**
- `join-room` - Join a transfer room
- `signal` - WebRTC signal relay
- `ping` - Connection keepalive

**Server → Client:**
- `room-joined` - Room join confirmation `{ role: 'sender' | 'receiver' }`
- `user-connected` - Peer joined notification
- `room-full` - Room already has 2 peers
- `signal` - WebRTC signal relay
- `peer-disconnected` - Peer left

---

## 8. Configuration

### 8.1 Server Environment Variables

```bash
# Required
CLIENT_URL=http://localhost:3000
PORT=3001

# Optional - Cloudflare TURN (recommended for production)
CLOUDFLARE_TURN_KEY_ID=
CLOUDFLARE_TURN_KEY_API_TOKEN=

# Optional - Self-hosted coturn
TURN_SECRET=your-hmac-secret
TURN_DOMAIN=turn.example.com

# Optional - Stats persistence
UPSTASH_REDIS_REST_URL=https://xxx.upstash.io
UPSTASH_REDIS_REST_TOKEN=xxx

# Optional - Limits
MAX_CONNECTIONS_PER_IP=30
MAX_TURN_REQUESTS_PER_IP=20
MAX_CODE_REQUESTS_PER_IP=60
MAX_ACTIVE_CODES=10000
MAX_REPORT_BYTES=576460752303423487  # 5 TiB

# Optional - Security
TRUSTED_PROXY_COUNT=1
NODE_ENV=production
```

### 8.2 Client Environment Variables

```bash
# Build-time (embedded in bundle)
NEXT_PUBLIC_SOCKET_URL=http://localhost:3001

# Optional
NEXT_PUBLIC_SITE_URL=http://localhost:3000
NEXT_PUBLIC_SENTRY_DSN=
NEXT_PUBLIC_UMAMI_WEBSITE_ID=
```

---

## 9. Docker Deployment

### Quick Start
```bash
# Download docker-compose.yml
curl -fsSLO https://raw.githubusercontent.com/jannskiee/floe/main/docker-compose.yml

# Start stack
docker compose up -d

# Open app
open http://localhost:3000
```

### Production Setup with TURN
```bash
# Create .env file
cat > .env << 'EOF'
CLIENT_URL=https://your-domain.com
FLOE_IMAGE_TAG=latest

# Cloudflare TURN (recommended)
CLOUDFLARE_TURN_KEY_ID=your-key-id
CLOUDFLARE_TURN_KEY_API_TOKEN=your-token

# Or coturn
TURN_SECRET=your-secret
TURN_DOMAIN=turn.your-domain.com

# Stats
UPSTASH_REDIS_REST_URL=https://xxx.upstash.io
UPSTASH_REDIS_REST_TOKEN=xxx
EOF

# Start with TURN relay
docker compose --profile turn up -d
```

---

## 10. Implementation Checklist

### Server Implementation

- [ ] **Express Setup**
  - [ ] Install dependencies: `express`, `socket.io`, `ws`, `cors`, `helmet`, `dotenv`
  - [ ] Configure CORS with allowed origins
  - [ ] Set up `trust proxy` for IP rate limiting

- [ ] **Socket.IO Server**
  - [ ] Initialize with CORS configuration
  - [ ] Handle `join-room` event
  - [ ] Handle `signal` event
  - [ ] Handle `disconnecting` event
  - [ ] Implement rate limiting middleware

- [ ] **WebSocket Server (CLI)**
  - [ ] Create at `/ws` path
  - [ ] Implement heartbeat (ping/pong)
  - [ ] Handle `join-room`, `signal` messages
  - [ ] Implement rate limiting

- [ ] **Room Management**
  - [ ] In-memory room registry
  - [ ] Role assignment (sender/receiver)
  - [ ] Signal relay between peers
  - [ ] Cleanup on disconnect

- [ ] **TURN Credentials**
  - [ ] Cloudflare Realtime integration
  - [ ] Coturn HMAC-SHA1 credentials
  - [ ] STUN fallback
  - [ ] Cache management

- [ ] **Stats Counter**
  - [ ] Upstash Redis integration
  - [ ] GET `/api/stats` endpoint
  - [ ] POST `/api/stats/report` endpoint
  - [ ] In-memory cache

- [ ] **Rate Limiting**
  - [ ] Connection limiter
  - [ ] TURN endpoint limiter
  - [ ] Stats endpoint limiter
  - [ ] Code endpoint limiter
  - [ ] Cleanup interval

### Client Implementation

- [ ] **Next.js Setup**
  - [ ] Install: `next`, `react`, `simple-peer`, `socket.io-client`, `uuid`
  - [ ] Configure `NEXT_PUBLIC_SOCKET_URL`
  - [ ] Disable React Strict Mode (breaks Socket.IO)

- [ ] **Signaling Module**
  - [ ] Socket.IO connection management
  - [ ] Room joining
  - [ ] Signal relay
  - [ ] Reconnection handling

- [ ] **WebRTC Peer**
  - [ ] SimplePeer initialization
  - [ ] ICE configuration
  - [ ] Data channel handling
  - [ ] Connection state management

- [ ] **Transfer Protocol**
  - [ ] Sender implementation
  - [ ] Receiver implementation
  - [ ] Flow control (high/low water)
  - [ ] Chunking and backpressure
  - [ ] Ack handling with timeout

- [ ] **UI Components**
  - [ ] File selection (input + drag-drop)
  - [ ] File list display
  - [ ] Progress bar
  - [ ] Speed/ETA display
  - [ ] Share link generation
  - [ ] QR code generation
  - [ ] Received files list
  - [ ] Download handling

- [ ] **Connection Features**
  - [ ] Relay toggle
  - [ ] Direct/relay detection
  - [ ] Wake lock
  - [ ] Connection status badge

- [ ] **Analytics**
  - [ ] Stats reporting
  - [ ] Umami tracking
  - [ ] Sentry error tracking

### Security Checklist

- [ ] CORS configured for allowed origins only
- [ ] Rate limiting on all public endpoints
- [ ] Room IDs are UUID v4 (unpredictable)
- [ ] Room secrets in URL fragment (not sent to server)
- [ ] WebRTC DTLS encryption
- [ ] TURN with authentication
- [ ] Input validation on all endpoints
- [ ] Error messages don't leak internals

### Testing Checklist

- [ ] Unit tests for transfer protocol
- [ ] Unit tests for rate limiting
- [ ] E2E test: sender creates link
- [ ] E2E test: receiver joins via link
- [ ] E2E test: file transfer completes
- [ ] E2E test: multiple file transfer
- [ ] E2E test: reconnection handling
- [ ] E2E test: browser to CLI transfer
- [ ] E2E test: relay connection (if TURN configured)

---

## Key Implementation Notes

### Room ID in URL Fragment
The room ID MUST be in the URL fragment (`#room=<id>`), NOT in the query string. Fragments are:
- Never sent to the server
- Never appear in Referer headers
- Not logged by analytics

### WebRTC Framing
Control messages (metadata, ack, end) MUST be sent as TEXT frames. File data is BINARY. This is critical for receiver implementation.

### Backpressure Control
The sender implements backpressure using `bufferedamountlow` events:
- Pause sending when buffer >= HIGH_WATER (8 MB)
- Resume when buffer < LOW_WATER (4 MB)

### Protocol Version Compatibility
Peers exchange protocol version ranges in metadata/ack messages. If ranges don't overlap:
- Current peers: Send `incompatible` message with reason
- Legacy peers (pre-1.6.0): Treat as protocol v1

---

## Quick Reference

### Development Commands
```bash
# Server
cd server && npm install && npm run dev

# Client
cd client && pnpm install && pnpm dev

# Test
cd server && npm test
cd client && pnpm test
```

### Docker Commands
```bash
# Start
docker compose up -d

# Stop
docker compose down

# With TURN
docker compose --profile turn up -d

# Rebuild
docker compose up -d --build
```

### Important Ports
- `3000` - Client web app
- `3001` - Signaling server
- `3478` - Coturn STUN/TURN (if using)
- `5349` - Coturn TURN TLS (if using)
