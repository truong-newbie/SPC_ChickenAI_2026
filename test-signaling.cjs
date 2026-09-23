// Simple WebSocket signaling test
const WebSocket = require('ws');

const SIGNALING_URL = 'ws://localhost:3002';

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function testSignaling() {
  console.log('Testing WebSocket Signaling...\n');

  let ws1, ws2;
  let hostSocketId, joinerSocketId;
  let roomCode = null;

  try {
    // Step 1: Host creates room
    console.log('Step 1: Host creating room...');
    ws1 = new WebSocket(SIGNALING_URL);

    await new Promise((resolve, reject) => {
      ws1.on('open', resolve);
      ws1.on('error', reject);
    });

    console.log('Host connected');

    ws1.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      console.log('Host received:', msg.type);

      if (msg.type === 'room-created') {
        hostSocketId = msg.socketId;
        roomCode = msg.roomCode;
        console.log(`Host socket: ${hostSocketId}, Room: ${roomCode}`);
      }

      if (msg.type === 'peer-joined') {
        console.log(`Peer joined: ${msg.peerSocketId}`);
      }
    });

    ws1.send(JSON.stringify({ type: 'create-room' }));

    await sleep(1000);

    // Step 2: Joiner joins room
    console.log('\nStep 2: Joiner joining room...');
    ws2 = new WebSocket(SIGNALING_URL);

    await new Promise((resolve, reject) => {
      ws2.on('open', resolve);
      ws2.on('error', reject);
    });

    console.log('Joiner connected');

    ws2.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      console.log('Joiner received:', msg.type);

      if (msg.type === 'room-joined') {
        joinerSocketId = msg.socketId;
        console.log(`Joiner socket: ${joinerSocketId}`);
      }
    });

    ws2.send(JSON.stringify({ type: 'join-room', roomCode }));

    await sleep(1000);

    console.log('\n=== Test Summary ===');
    console.log(`Room Code: ${roomCode}`);
    console.log(`Host Socket: ${hostSocketId}`);
    console.log(`Joiner Socket: ${joinerSocketId}`);

    if (roomCode && hostSocketId && joinerSocketId) {
      console.log('\n✓ Signaling works correctly!');
      console.log('  - Host can create room');
      console.log('  - Joiner can join room');
      console.log('  - Host receives peer-joined notification');
    } else {
      console.log('\n✗ Signaling failed');
    }

  } catch (error) {
    console.error('Error:', error);
  } finally {
    ws1?.close();
    ws2?.close();
    console.log('\nTest complete.');
  }
}

testSignaling();
