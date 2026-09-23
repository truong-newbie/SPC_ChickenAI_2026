/**
 * FileBridge - Signaling-based P2P Service
 * Sử dụng local signaling server để kết nối 2 client qua mã phòng
 * - KHÔNG phụ thuộc PeerJS Cloud
 * - KHÔNG dùng Redis
 * - WebRTC vẫn dùng RTCPeerConnection trực tiếp (không qua PeerJS)
 */

import {
  generateKeyPair,
  exportPublicKey,
  importPublicKey,
  deriveSharedKey,
  encryptData,
  decryptData,
  EncryptedData,
} from '../utils/crypto';
import type { PeerMessage } from '../types';
import { generateFileId } from '../utils/room';

const CHUNK_SIZE = 64 * 1024;
const SIGNALING_SERVER = 'http://localhost:3002';

export interface TransferCallbacks {
  onPeerId?: (id: string) => void;
  onConnection?: () => void;
  onDisconnect?: () => void;
  onStatusChange?: (status: string, method?: string) => void;
  onFileProgress?: (fileId: string, progress: number, speed: number) => void;
  onFileComplete?: (fileId: string, file: File) => void;
  onError?: (error: string) => void;
}

interface PeerInfo {
  socketId: string;
  peerId: string;
}

class RoomBasedService {
  private socket: WebSocket | null = null;
  private mySocketId: string | null = null;
  private peerInfo: PeerInfo | null = null;
  private pc: RTCPeerConnection | null = null;
  private dataChannel: RTCDataChannel | null = null;
  private remoteDataChannel: RTCDataChannel | null = null;
  private callbacks: TransferCallbacks = {};
  private isConnected = false;
  private isHost = false;
  private myKeyPair: CryptoKeyPair | null = null;
  private sharedKey: CryptoKey | null = null;
  private fileChunks: Map<string, { chunks: ArrayBuffer[]; meta: any }> = new Map();
  private isInitiatingConnection = false;
  private pendingIceCandidates: RTCIceCandidateInit[] = [];

  initialize(callbacks: TransferCallbacks) {
    this.callbacks = callbacks;
  }

  /**
   * Tạo phòng - host
   */
  async createRoom(): Promise<string> {
    this.connectSignaling();
    this.isHost = true;
    this.callbacks.onStatusChange?.('connecting');

    // Wait for socket to open
    await this.waitForSocket();

    return new Promise((resolve, reject) => {
      const handler = (event: MessageEvent) => {
        const data = JSON.parse(event.data);
        if (data.type === 'room-created') {
          this.mySocketId = data.socketId;
          this.callbacks.onPeerId?.(data.roomCode);
          resolve(data.roomCode);
        } else if (data.type === 'peer-joined') {
          // Only start connection if not already initiating
          if (!this.isInitiatingConnection) {
            this.peerInfo = { socketId: data.peerSocketId, peerId: data.peerPeerId };
            this.startConnection(true);
          }
        } else if (data.type === 'error') {
          reject(new Error(data.message));
        }
      };

      this.socket!.addEventListener('message', handler);

      this.sendSignaling({ type: 'create-room' });
    });
  }

  private waitForSocket(): Promise<void> {
    return new Promise((resolve) => {
      if (this.socket?.readyState === WebSocket.OPEN) {
        resolve();
        return;
      }
      const handler = () => {
        this.socket?.removeEventListener('open', handler);
        resolve();
      };
      this.socket?.addEventListener('open', handler);
    });
  }

  /**
   * Tham gia phòng
   */
  async joinRoom(roomCode: string): Promise<void> {
    this.connectSignaling();
    this.isHost = false;
    this.callbacks.onStatusChange?.('connecting');

    return new Promise((resolve, reject) => {
      const handler = (event: MessageEvent) => {
        const data = JSON.parse(event.data);
        if (data.type === 'room-joined') {
          this.mySocketId = data.socketId;
          this.peerInfo = { socketId: data.hostSocketId, peerId: data.hostPeerId };
          // Người join chờ offer từ host
          this.setupPeerConnection();
          resolve();
        } else if (data.type === 'error') {
          reject(new Error(data.message));
        }
      };

      this.socket!.addEventListener('message', handler, { once: false });

      setTimeout(() => {
        this.sendSignaling({ type: 'join-room', roomCode });
      }, 100);
    });
  }

  private connectSignaling() {
    if (this.socket) return;

    this.callbacks.onStatusChange?.('connecting');

    this.socket = new WebSocket(SIGNALING_SERVER.replace('http', 'ws'));

    this.socket.onopen = () => {
      console.log('Signaling connected');
    };

    this.socket.onmessage = (event) => {
      const data = JSON.parse(event.data);
      this.handleSignalingMessage(data);
    };

    this.socket.onerror = () => {
      this.callbacks.onError?.('Không thể kết nối signaling server. Hãy chạy: cd server && npm start');
    };

    this.socket.onclose = () => {
      this.callbacks.onDisconnect?.();
    };
  }

  private sendSignaling(message: any) {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(message));
    }
  }

  private handleSignalingMessage(data: any) {
    switch (data.type) {
      case 'room-created':
        // Đã xử lý trong createRoom
        break;

      case 'room-joined':
        // Đã xử lý trong joinRoom
        break;

      case 'peer-joined':
        this.peerInfo = { socketId: data.peerSocketId, peerId: data.peerPeerId };
        if (this.isHost) {
          this.startConnection(true);
        }
        break;

      case 'offer':
        this.handleOffer(data.offer, data.fromSocketId);
        break;

      case 'answer':
        this.handleAnswer(data.answer);
        break;

      case 'ice-candidate':
        this.handleIceCandidate(data.candidate);
        break;

      case 'peer-disconnected':
        this.callbacks.onDisconnect?.();
        break;
    }
  }

  /**
   * Khởi tạo RTCPeerConnection
   */
  private setupPeerConnection() {
    this.pc = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        { urls: 'stun:stun3.l.google.com:19302' },
        { urls: 'stun:stun4.l.google.com:19302' },
        { urls: 'stun:stun.cloudflare.com:3478' },
        // Open Relay Project - free TURN servers for NAT traversal
        {
          urls: 'turn:openrelay.metered.ca:80',
          username: 'openrelayproject',
          credential: 'openrelayproject',
        },
        {
          urls: 'turn:openrelay.metered.ca:443',
          username: 'openrelayproject',
          credential: 'openrelayproject',
        },
        {
          urls: 'turn:openrelay.metered.ca:443?transport=tcp',
          username: 'openrelayproject',
          credential: 'openrelayproject',
        },
      ],
      iceCandidatePoolSize: 10,
      iceTransportPolicy: 'all',
      bundlePolicy: 'max-bundle',
    });

    this.pc.onicecandidate = (event) => {
      if (this.peerInfo) {
        if (event.candidate) {
          console.log('ICE candidate:', event.candidate.candidate);
          this.sendSignaling({
            type: 'ice-candidate',
            targetSocketId: this.peerInfo.socketId,
            candidate: event.candidate,
          });
        } else {
          // null candidate = end of candidates
          console.log('ICE gathering complete');
          this.sendSignaling({
            type: 'ice-candidate-complete',
            targetSocketId: this.peerInfo.socketId,
          });
        }
      }
    };

    this.pc.onicegatheringstatechange = () => {
      console.log('ICE gathering state:', this.pc?.iceGatheringState);
      if (this.pc?.iceGatheringState === 'complete' && this.peerInfo) {
        this.sendSignaling({
          type: 'ice-candidate-complete',
          targetSocketId: this.peerInfo.socketId,
        });
      }
    };

    this.pc.oniceconnectionstatechange = () => {
      console.log('ICE connection state:', this.pc?.iceConnectionState);
      if (this.pc?.iceConnectionState === 'failed') {
        console.error('ICE connection failed - check NAT/firewall');
      }
    };

    this.pc.onconnectionstatechange = () => {
      const state = this.pc?.connectionState;
      console.log('Connection state:', state);
      if (state === 'connected') {
        this.isConnected = true;
        this.callbacks.onConnection?.();
        this.callbacks.onStatusChange?.('connected');
      } else if (state === 'failed' || state === 'disconnected' || state === 'closed') {
        this.isConnected = false;
        this.callbacks.onDisconnect?.();
      }
    };

    this.pc.ondatachannel = (event) => {
      this.remoteDataChannel = event.channel;
      this.setupDataChannelHandlers(this.remoteDataChannel);
    };
  }

  /**
   * Host khởi tạo kết nối - tạo offer
   */
  private async startConnection(isOfferer: boolean) {
    if (this.isInitiatingConnection) {
      console.log('Connection already initiating, skipping');
      return;
    }
    this.isInitiatingConnection = true;

    this.setupPeerConnection();

    if (isOfferer) {
      this.dataChannel = this.pc!.createDataChannel('filebridge', {
        ordered: true,
      });
      this.setupDataChannelHandlers(this.dataChannel);

      const offer = await this.pc!.createOffer();
      await this.pc!.setLocalDescription(offer);

      this.sendSignaling({
        type: 'offer',
        targetSocketId: this.peerInfo!.socketId,
        offer: this.pc!.localDescription,
      });
    }
  }

  private async handleOffer(offer: RTCSessionDescriptionInit, fromSocketId: string) {
    this.setupPeerConnection();

    await this.pc!.setRemoteDescription(offer);

    // Process any pending ICE candidates
    await this.processPendingIceCandidates();

    const answer = await this.pc!.createAnswer();
    await this.pc!.setLocalDescription(answer);

    this.sendSignaling({
      type: 'answer',
      targetSocketId: fromSocketId,
      answer: this.pc!.localDescription,
    });
  }

  private async handleAnswer(answer: RTCSessionDescriptionInit) {
    await this.pc!.setRemoteDescription(answer);
    // Process any pending ICE candidates after setting remote description
    await this.processPendingIceCandidates();
  }

  private async processPendingIceCandidates() {
    if (this.pendingIceCandidates.length > 0 && this.pc) {
      console.log(`Processing ${this.pendingIceCandidates.length} pending ICE candidates`);
      for (const candidate of this.pendingIceCandidates) {
        try {
          await this.pc.addIceCandidate(candidate);
        } catch (e) {
          console.error('Error adding pending ICE candidate', e);
        }
      }
      this.pendingIceCandidates = [];
    }
  }

  private async handleIceCandidate(candidate: RTCIceCandidateInit) {
    // If remote description is not set yet, queue the candidate
    if (!this.pc?.remoteDescription || !this.pc.remoteDescription.type) {
      console.log('Remote description not set, queueing ICE candidate');
      this.pendingIceCandidates.push(candidate);
      return;
    }

    try {
      await this.pc?.addIceCandidate(candidate);
    } catch (e) {
      console.error('Error adding ICE candidate', e);
    }
  }

  private setupDataChannelHandlers(channel: RTCDataChannel) {
    channel.binaryType = 'arraybuffer';

    channel.onopen = () => {
      console.log('DataChannel opened');
      this.performKeyExchange();
    };

    channel.onclose = () => {
      console.log('DataChannel closed');
    };

    channel.onerror = (err) => {
      console.error('DataChannel error', err);
    };

    channel.onmessage = (event) => {
      try {
        const message: PeerMessage = JSON.parse(event.data);
        this.handleDataMessage(message);
      } catch (e) {
        console.error('Error parsing message', e);
      }
    };
  }

  private async performKeyExchange() {
    try {
      this.myKeyPair = await generateKeyPair();
      const publicKeyBuffer = await exportPublicKey(this.myKeyPair.publicKey);
      const publicKeyArray = new Uint8Array(publicKeyBuffer);

      this.sendViaDataChannel({
        type: 'text',
        text: `key_exchange:${Array.from(publicKeyArray).join(',')}`,
      });
    } catch (error) {
      console.error('Key exchange error:', error);
    }
  }

  private async handleKeyExchange(keyData: number[]) {
    try {
      const keyBuffer = new Uint8Array(keyData).buffer;
      const peerPublicKey = await importPublicKey(keyBuffer);
      this.sharedKey = await deriveSharedKey(this.myKeyPair!.privateKey, peerPublicKey);
      console.log('Shared key established');
    } catch (error) {
      console.error('Key exchange error:', error);
    }
  }

  private sendViaDataChannel(message: PeerMessage) {
    const channel = this.dataChannel || this.remoteDataChannel;
    if (channel && channel.readyState === 'open') {
      channel.send(JSON.stringify(message));
    }
  }

  private async handleDataMessage(message: PeerMessage) {
    switch (message.type) {
      case 'text':
        if (message.text?.startsWith('key_exchange:')) {
          const keyData = message.text
            .replace('key_exchange:', '')
            .split(',')
            .map(Number);
          await this.handleKeyExchange(keyData);
          if (!this.sharedKey) {
            await this.performKeyExchange();
          }
        }
        break;

      case 'file-meta':
        if (message.fileId && message.fileName && message.fileSize) {
          this.fileChunks.set(message.fileId, {
            chunks: [],
            meta: {
              id: message.fileId,
              name: message.fileName,
              size: message.fileSize,
              type: message.fileType || 'application/octet-stream',
            },
          });
        }
        break;

      case 'file-chunk':
        if (message.fileId && message.chunk) {
          const fileData = this.fileChunks.get(message.fileId);
          if (fileData) {
            try {
              const encryptedData: EncryptedData = {
                ciphertext: message.chunk,
                iv: new Uint8Array(message.iv || new ArrayBuffer(0)),
              };

              let decryptedChunk: ArrayBuffer;
              if (this.sharedKey && message.iv) {
                decryptedChunk = await decryptData(encryptedData, this.sharedKey);
              } else {
                decryptedChunk = message.chunk;
              }

              fileData.chunks.push(decryptedChunk);
              const progress = (fileData.chunks.length / (message.totalChunks || 1)) * 100;
              this.callbacks.onFileProgress?.(message.fileId!, progress, 0);
            } catch (error) {
              console.error('Decryption error:', error);
            }
          }
        }
        break;

      case 'file-complete':
        if (message.fileId) {
          await this.assembleFile(message.fileId);
        }
        break;
    }
  }

  private async assembleFile(fileId: string) {
    const fileData = this.fileChunks.get(fileId);
    if (!fileData) return;

    const { chunks, meta } = fileData;
    const blob = new Blob(chunks, { type: meta.type });
    const file = new File([blob], meta.name, { type: meta.type });

    this.callbacks.onFileComplete?.(fileId, file);
    this.fileChunks.delete(fileId);
  }

  /**
   * Gửi file(s) - hỗ trợ folder, ảnh, Google Drive
   */
  async sendFiles(items: (File | DataTransferItem)[]): Promise<string[]> {
    const fileIds: string[] = [];

    for (const item of items) {
      let file: File | null = null;

      if (item instanceof DataTransferItem) {
        if (item.kind === 'file') {
          file = item.getAsFile();
          if (item.webkitGetAsEntry) {
            const entry = item.webkitGetAsEntry();
            if (entry?.isDirectory) {
              const dirFiles = await this.readDirectory(entry as FileSystemDirectoryEntry);
              for (const dirFile of dirFiles) {
                const id = await this.sendSingleFile(dirFile);
                fileIds.push(id);
              }
              continue;
            }
          }
        }
      } else if (item instanceof File) {
        file = item;
      }

      if (file) {
        const id = await this.sendSingleFile(file);
        fileIds.push(id);
      }
    }

    return fileIds;
  }

  private async readDirectory(dirEntry: FileSystemDirectoryEntry): Promise<File[]> {
    const files: File[] = [];

    return new Promise((resolve, reject) => {
      const reader = dirEntry.createReader();

      const readEntries = () => {
        reader.readEntries(async (entries) => {
          for (const entry of entries) {
            if (entry.isFile) {
              const file = await this.getFileFromEntry(entry as FileSystemFileEntry);
              if (file) files.push(file);
            } else if (entry.isDirectory) {
              const subFiles = await this.readDirectory(entry as FileSystemDirectoryEntry);
              files.push(...subFiles);
            }
          }

          if (entries.length === 0) {
            resolve(files);
          } else {
            readEntries();
          }
        }, reject);
      };

      readEntries();
    });
  }

  private getFileFromEntry(entry: FileSystemFileEntry): Promise<File | null> {
    return new Promise((resolve) => {
      entry.file((file) => resolve(file), () => resolve(null));
    });
  }

  private async sendSingleFile(file: File): Promise<string> {
    const fileId = generateFileId();
    const totalChunks = Math.ceil(file.size / CHUNK_SIZE);

    this.sendViaDataChannel({
      type: 'file-meta',
      fileId,
      fileName: file.name,
      fileSize: file.size,
      fileType: file.type,
    });

    const arrayBuffer = await file.arrayBuffer();
    let lastTime = Date.now();

    for (let i = 0; i < totalChunks; i++) {
      const start = i * CHUNK_SIZE;
      const end = Math.min(start + CHUNK_SIZE, file.size);
      const chunk = arrayBuffer.slice(start, end);

      let encryptedChunk: ArrayBuffer;
      let iv: Uint8Array = new Uint8Array(0);

      if (this.sharedKey) {
        const encrypted = await encryptData(chunk, this.sharedKey);
        encryptedChunk = encrypted.ciphertext;
        iv = encrypted.iv as Uint8Array;
      } else {
        encryptedChunk = chunk;
      }

      const chunkArray = new Uint8Array(encryptedChunk);

      this.sendViaDataChannel({
        type: 'file-chunk',
        fileId,
        chunk: chunkArray.buffer as ArrayBuffer,
        iv: Array.from(iv),
        chunkIndex: i,
        totalChunks,
      });

      const progress = ((i + 1) / totalChunks) * 100;
      const now = Date.now();
      const elapsed = (now - lastTime) / 1000;
      let speed = 0;
      if (elapsed >= 0.5) {
        speed = ((i + 1) * CHUNK_SIZE) / elapsed;
        lastTime = now;
      }

      this.callbacks.onFileProgress?.(fileId, progress, speed);

      await new Promise((resolve) => setTimeout(resolve, 5));
    }

    this.sendViaDataChannel({ type: 'file-complete', fileId });

    return fileId;
  }

  disconnect() {
    if (this.dataChannel) {
      this.dataChannel.close();
      this.dataChannel = null;
    }
    if (this.pc) {
      this.pc.close();
      this.pc = null;
    }
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
    this.isConnected = false;
    this.isInitiatingConnection = false;
    this.pendingIceCandidates = [];
    this.peerInfo = null;
    this.callbacks.onDisconnect?.();
  }

  destroy() {
    this.disconnect();
    this.myKeyPair = null;
    this.sharedKey = null;
    this.fileChunks.clear();
    this.isInitiatingConnection = false;
    this.pendingIceCandidates = [];
  }

  isPeerConnected(): boolean {
    return this.isConnected;
  }

  getMySocketId(): string | null {
    return this.mySocketId;
  }
}

export const p2pService = new RoomBasedService();
export default p2pService;
