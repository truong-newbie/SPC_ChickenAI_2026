/**
 * FileBridge P2P Service
 * Refactored to use Socket.IO and Floe's transfer protocol
 */

import { io, Socket } from 'socket.io-client';
import { createReceiver, type ReceivedFile } from '../lib/transfer/receiver';
import { sendFiles, type FileEntry } from '../lib/transfer/sender';
import { generateFileId } from '../lib/transfer/protocol';
import { generateRoomId, buildShareLink } from '../lib/roomLink';

// Types
export interface TransferCallbacks {
  onConnection?: () => void;
  onDisconnect?: () => void;
  onStatusChange?: (status: 'idle' | 'connecting' | 'waiting' | 'connected' | 'disconnected') => void;
  onPeerId?: (peerId: string) => void;
  onError?: (error: string) => void;
  onFilesReceived?: (files: ReceivedFile[]) => void;
  onFileStart?: (index: number, total: number, fileName: string, fileSize?: number) => void;
  onProgress?: (percent: number, received?: number, total?: number) => void;
  onSpeed?: (bytesPerSec: number, etaSeconds: number) => void;
  onFileComplete?: (file: { fileName: string; fileSize: number }, index: number, total: number) => void;
  onTransferComplete?: () => void;
}

const SIGNALING_SERVER = 'http://localhost:3002';

class RoomBasedService {
  private socket: Socket | null = null;
  private peerSocketId: string | null = null;
  private pc: RTCPeerConnection | null = null;
  private dataChannel: RTCDataChannel | null = null;
  private remoteDataChannel: RTCDataChannel | null = null;
  private callbacks: TransferCallbacks = {};
  private isConnected = false;
  private isHost = false;
  private receivedFiles: ReceivedFile[] = [];
  private isInitiatingConnection = false;
  private pendingFiles: File[] = [];
  private isSending = false;

  initialize(callbacks: TransferCallbacks) {
    this.callbacks = callbacks;
  }

  /**
   * Create a room - becomes the sender
   * Returns shareable link with room ID in URL fragment
   */
  async createRoom(): Promise<string> {
    this.connectSignaling();
    this.isHost = true;
    this.callbacks.onStatusChange?.('connecting');

    // Generate UUID room ID
    const roomId = generateRoomId();
    console.log('[P2P] Creating room:', roomId);

    // Wait for socket
    await this.waitForSocket();

    return new Promise((resolve, reject) => {
      const handleRoomJoined = (_data: { roomCode: string; role: string }) => {
        this.socket?.off('room-joined', handleRoomJoined);
        console.log('[P2P] Room created, initiating WebRTC...');
        // Sender initiates WebRTC connection
        this.initiateConnection();
        // Return full share link with UUID in fragment
        const link = buildShareLink(window.location.origin, roomId);
        resolve(link);
      };

      this.socket?.on('room-joined', handleRoomJoined);
      this.socket?.on('error', (err: Error) => reject(err));

      // Join with specific room ID
      this.socket?.emit('join-room', roomId);
    });
  }

  /**
   * Join a room - becomes the receiver
   * Gets room ID from URL fragment
   */
  async joinRoom(): Promise<void> {
    this.connectSignaling();
    this.isHost = false;
    this.callbacks.onStatusChange?.('connecting');

    // Get room ID from URL fragment
    const roomId = this.getRoomFromUrl();
    if (!roomId) {
      throw new Error('No room ID in URL');
    }
    console.log('[P2P] Joining room:', roomId);

    await this.waitForSocket();

    return new Promise((resolve, reject) => {
      const handleRoomJoined = (_data: { roomCode: string; role: string }) => {
        this.socket?.off('room-joined', handleRoomJoined);
        console.log('[P2P] Joined as receiver');
        resolve();
      };

      this.socket?.on('room-joined', handleRoomJoined);
      this.socket?.on('error', (err: Error) => reject(err));

      this.socket?.emit('join-room', roomId);
    });
  }

  private getRoomFromUrl(): string | null {
    if (typeof window === 'undefined') return null;
    const hash = window.location.hash;
    const match = hash.match(/[#&]?room=([^&]+)/);
    return match ? match[1] : null;
  }

  private connectSignaling() {
    if (this.socket?.connected) return;

    this.socket = io(SIGNALING_SERVER, {
      reconnection: true,
      reconnectionDelay: 500,
      reconnectionDelayMax: 3000,
    });

    this.socket.on('connect', () => {
      console.log('[P2P] Signaling connected');
      this.callbacks.onStatusChange?.('waiting');
    });

    this.socket.on('disconnect', () => {
      console.log('[P2P] Signaling disconnected');
      this.callbacks.onStatusChange?.('disconnected');
    });

    this.socket.on('connect_error', (err) => {
      console.error('[P2P] Connection error:', err);
      this.callbacks.onError?.('Cannot connect to signaling server');
    });

    // Handle incoming signals
    this.socket.on('signal', (data: any) => {
      console.log('[P2P] Received signal:', data.signal?.type || 'unknown');
      if (data.signal) {
        this.handleSignal(data.signal);
      }
    });

    this.socket.on('peer-disconnected', () => {
      console.log('[P2P] Peer disconnected');
      this.isConnected = false;
      this.callbacks.onDisconnect?.();
    });

    this.socket.on('room-full', () => {
      console.log('[P2P] Room is full');
      this.callbacks.onError?.('Room is full');
    });
  }

  private waitForSocket(): Promise<void> {
    return new Promise((resolve) => {
      if (this.socket?.connected) {
        resolve();
        return;
      }
      const check = setInterval(() => {
        if (this.socket?.connected) {
          clearInterval(check);
          resolve();
        }
      }, 100);
    });
  }

  private handleSignal(signal: RTCSessionDescriptionInit | RTCIceCandidateInit) {
    if (!this.pc) return;

    // Check if it's a session description (has 'type') or ICE candidate (has 'candidate')
    if ('type' in signal && ('offer' === (signal as any).type || 'answer' === (signal as any).type)) {
      if ((signal as any).type === 'offer') {
        this.handleOffer(signal as RTCSessionDescriptionInit);
      } else {
        this.handleAnswer(signal as RTCSessionDescriptionInit);
      }
    } else if ('candidate' in signal) {
      this.handleIceCandidate(signal as RTCIceCandidateInit);
    }
  }

  private startConnection(isOfferer: boolean) {
    if (this.isInitiatingConnection) return;
    this.isInitiatingConnection = true;

    this.setupPeerConnection();

    if (isOfferer) {
      // Create data channel
      this.dataChannel = this.pc!.createDataChannel('filebridge', {
        ordered: true,
      });
      this.setupDataChannelHandlers(this.dataChannel);

      // Create offer
      this.pc!.createOffer().then(offer => {
        return this.pc!.setLocalDescription(offer);
      }).then(() => {
        this.sendSignal(this.pc!.localDescription!);
      });
    }
  }

  // Called by sender when creating room to initiate WebRTC
  initiateConnection() {
    this.startConnection(true);
  }

  private setupPeerConnection() {
    this.pc = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        { urls: 'stun:stun3.l.google.com:19302' },
        { urls: 'stun:stun4.l.google.com:19302' },
        { urls: 'stun:stun.cloudflare.com:3478' },
      ],
      iceCandidatePoolSize: 10,
    });

    this.pc.oniceconnectionstatechange = () => {
      console.log('[P2P] ICE connection state:', this.pc?.iceConnectionState);
    };

    this.pc.onconnectionstatechange = () => {
      const state = this.pc?.connectionState;
      console.log('[P2P] Connection state:', state);
      if (state === 'connected') {
        this.isConnected = true;
        this.callbacks.onConnection?.();
        this.callbacks.onStatusChange?.('connected');
      } else if (state === 'failed' || state === 'disconnected' || state === 'closed') {
        this.isConnected = false;
        this.callbacks.onDisconnect?.();
      }
    };

    this.pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.sendSignal(event.candidate);
      }
    };

    this.pc.ondatachannel = (event) => {
      console.log('[P2P] Data channel received');
      this.remoteDataChannel = event.channel;
      this.setupDataChannelHandlers(this.remoteDataChannel);
    };
  }

  private setupDataChannelHandlers(channel: RTCDataChannel) {
    const receiver = createReceiver({
      send: (data) => {
        if (channel.readyState === 'open') {
          // Cast to any to handle ArrayBufferLike vs ArrayBuffer mismatch
          channel.send(data as any);
        }
      },
      onFileStart: (index, total, fileName, fileSize) => {
        console.log(`[P2P] Receiving file ${index + 1}/${total}: ${fileName} (${fileSize} bytes)`);
        this.callbacks.onFileStart?.(index, total, fileName);
      },
      onProgress: (percent, received, total) => {
        this.callbacks.onProgress?.(percent, received, total);
      },
      onSpeed: (bytesPerSec, eta) => {
        this.callbacks.onSpeed?.(bytesPerSec, eta);
      },
      onFileComplete: (file, index, total) => {
        console.log(`[P2P] File complete: ${file.fileName}`);
        this.receivedFiles.push(file);
        this.callbacks.onFileComplete?.(file, index, total);
      },
      onAllComplete: (totalBytes, fileCount) => {
        console.log(`[P2P] Transfer complete: ${fileCount} files, ${totalBytes} bytes`);
        this.callbacks.onFilesReceived?.(this.receivedFiles);
        this.callbacks.onTransferComplete?.();
        this.receivedFiles = [];
      },
      onWaiting: () => {
        this.callbacks.onStatusChange?.('waiting');
      },
      onError: (msg) => {
        console.error('[P2P] Transfer error:', msg);
        this.callbacks.onError?.(msg);
      },
    });

    channel.onopen = () => {
      console.log('[P2P] Data channel OPEN');
      this.callbacks.onStatusChange?.('connected');
      this.isConnected = true;
      this.callbacks.onConnection?.();
      this.maybeAutoSend();
    };

    channel.onclose = () => {
      console.log('[P2P] Data channel closed');
    };

    channel.onmessage = (event) => {
      receiver.handleMessage(event.data);
    };

    // Save for sending
    if (channel === this.dataChannel) {
      this.dataChannel = channel;
    } else {
      this.remoteDataChannel = channel;
    }
  }

  private async maybeAutoSend() {
    if (this.pendingFiles.length === 0 || this.isSending) return;
    if (!this.dataChannel || this.dataChannel.readyState !== 'open') return;
    this.isSending = true;
    try {
      await this.sendFiles(this.pendingFiles);
    } finally {
      this.isSending = false;
    }
  }

  private sendSignal(signal: RTCSessionDescriptionInit | RTCIceCandidateInit) {
    if (!this.socket?.connected || !this.peerSocketId) return;
    this.socket.emit('signal', {
      signal,
      target: this.peerSocketId,
    });
  }

  private async handleOffer(offer: RTCSessionDescriptionInit) {
    if (!this.pc) {
      this.setupPeerConnection();
    }
    await this.pc!.setRemoteDescription(offer);
    const answer = await this.pc!.createAnswer();
    await this.pc!.setLocalDescription(answer);
    this.sendSignal(answer);
  }

  private async handleAnswer(answer: RTCSessionDescriptionInit) {
    await this.pc!.setRemoteDescription(answer);
  }

  private async handleIceCandidate(candidate: RTCIceCandidateInit) {
    try {
      await this.pc!.addIceCandidate(candidate);
    } catch (e) {
      console.error('[P2P] Error adding ICE candidate:', e);
    }
  }

  /**
   * Queue files to send over the data channel.
   * If channel is not yet open, will auto-send when it opens.
   */
  async sendFiles(files: File[]): Promise<void> {
    if (!this.dataChannel || this.dataChannel.readyState !== 'open') {
      // Queue files for auto-send when channel opens
      this.pendingFiles = [...this.pendingFiles, ...files];
      console.log(`[P2P] Queued ${files.length} files for auto-send`);
      return;
    }

    const entries: FileEntry[] = files.map(file => ({
      id: generateFileId(),
      file,
    }));

    const sctpMax = this.pc?.sctp?.maxMessageSize;

    await sendFiles(
      {
        send: (data) => {
          if (this.dataChannel?.readyState === 'open') {
            // Cast to any to handle ArrayBufferLike vs ArrayBuffer mismatch
            this.dataChannel.send(data as any);
          }
        },
        onData: () => () => {},
        channel: this.dataChannel!,
        sctpMaxMessageSize: sctpMax ?? undefined,
      },
      entries,
      {
        onFileStart: (index, total, fileName) => {
          console.log(`[P2P] Sending file ${index + 1}/${total}: ${fileName}`);
          this.callbacks.onFileStart?.(index, total, fileName);
        },
        onProgress: (percent) => {
          this.callbacks.onProgress?.(percent);
        },
        onSpeed: (bytesPerSec, eta) => {
          this.callbacks.onSpeed?.(bytesPerSec, eta);
        },
        onAllSent: () => {
          console.log('[P2P] All files sent');
          this.callbacks.onTransferComplete?.();
        },
        onError: (msg) => {
          console.error('[P2P] Send error:', msg);
          this.callbacks.onError?.(msg);
        },
      }
    );
  }

  /**
   * Disconnect and cleanup
   */
  disconnect() {
    if (this.pc) {
      this.pc.close();
      this.pc = null;
    }
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
    this.isConnected = false;
    this.dataChannel = null;
    this.remoteDataChannel = null;
  }

  isConnectedToPeer(): boolean {
    return this.isConnected;
  }

  isHostPeer(): boolean {
    return this.isHost;
  }
}

// Singleton instance
export const p2pService = new RoomBasedService();
