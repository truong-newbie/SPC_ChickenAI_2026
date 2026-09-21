import Peer, { DataConnection } from 'peerjs';
import {
  generateKeyPair,
  exportPublicKey,
  importPublicKey,
  deriveSharedKey,
  encryptData,
  decryptData,
  EncryptedData,
} from '../utils/crypto';
import type { PeerMessage, FileTransfer } from '../types';
import { generateFileId } from '../utils/room';

const CHUNK_SIZE = 1024 * 1024; // 1MB chunks

interface P2PServiceConfig {
  onPeerId?: (id: string) => void;
  onConnection?: () => void;
  onDisconnect?: () => void;
  onFileProgress?: (fileId: string, progress: number, speed: number) => void;
  onFileComplete?: (fileId: string, file: File) => void;
  onError?: (error: string) => void;
}

class P2PService {
  private peer: Peer | null = null;
  private connection: DataConnection | null = null;
  private config: P2PServiceConfig = {};
  private myKeyPair: CryptoKeyPair | null = null;
  private sharedKey: CryptoKey | null = null;
  private fileChunks: Map<string, { chunks: ArrayBuffer[]; meta: FileTransfer }> = new Map();

  initialize(config: P2PServiceConfig) {
    this.config = config;
    this.createPeer();
  }

  private createPeer() {
    this.peer = new Peer({
      debug: 1,
      config: {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' },
        ],
      },
    });

    this.peer.on('open', (id) => {
      console.log('Peer connected with ID:', id);
      this.config.onPeerId?.(id);
    });

    this.peer.on('connection', (conn) => {
      this.handleConnection(conn);
    });

    this.peer.on('error', (err) => {
      console.error('Peer error:', err);
      this.config.onError?.(err.message);
    });

    this.peer.on('disconnected', () => {
      console.log('Peer disconnected');
      this.config.onDisconnect?.();
    });
  }

  private async handleConnection(conn: DataConnection) {
    this.connection = conn;

    conn.on('open', async () => {
      console.log('Connection opened');
      this.config.onConnection?.();
      await this.performKeyExchange();
    });

    conn.on('data', (data) => {
      this.handleMessage(data as PeerMessage);
    });

    conn.on('close', () => {
      console.log('Connection closed');
      this.config.onDisconnect?.();
    });

    conn.on('error', (err) => {
      console.error('Connection error:', err);
      this.config.onError?.(err.message);
    });
  }

  async connect(peerId: string): Promise<void> {
    if (!this.peer) throw new Error('Peer not initialized');

    return new Promise((resolve, reject) => {
      const conn = this.peer!.connect(peerId, {
        reliable: true,
      });

      conn.on('open', async () => {
        this.connection = conn;
        console.log('Connected to peer:', peerId);
        this.config.onConnection?.();
        await this.performKeyExchange();
        resolve();
      });

      conn.on('data', (data) => {
        this.handleMessage(data as PeerMessage);
      });

      conn.on('close', () => {
        console.log('Connection closed');
        this.config.onDisconnect?.();
      });

      conn.on('error', (err) => {
        console.error('Connection error:', err);
        this.config.onError?.(err.message);
        reject(err);
      });
    });
  }

  private async performKeyExchange() {
    try {
      this.myKeyPair = await generateKeyPair();
      const publicKeyBuffer = await exportPublicKey(this.myKeyPair.publicKey);
      const publicKeyArray = new Uint8Array(publicKeyBuffer);

      this.send({
        type: 'text',
        text: `key_exchange:${Array.from(publicKeyArray).join(',')}`,
      });

      // First peer to connect becomes initiator and also sends key
      // For simplicity, we always send our key when connecting
    } catch (error) {
      console.error('Key exchange error:', error);
      this.config.onError?.('Lỗi khởi tạo mã hóa');
    }
  }

  async sendPublicKey() {
    if (!this.myKeyPair) {
      await this.performKeyExchange();
    }
  }

  private async handleKeyExchange(keyData: number[]) {
    try {
      const keyBuffer = new Uint8Array(keyData).buffer;
      const peerPublicKey = await importPublicKey(keyBuffer);
      this.sharedKey = await deriveSharedKey(
        this.myKeyPair!.privateKey,
        peerPublicKey
      );
      console.log('Shared key established');
    } catch (error) {
      console.error('Key exchange error:', error);
      this.config.onError?.('Lỗi thiết lập khóa mã hóa');
    }
  }

  send(message: PeerMessage) {
    if (this.connection?.open) {
      this.connection.send(message);
    }
  }

  private async handleMessage(message: PeerMessage) {
    switch (message.type) {
      case 'text':
        if (message.text?.startsWith('key_exchange:')) {
          const keyData = message.text
            .replace('key_exchange:', '')
            .split(',')
            .map(Number);
          await this.handleKeyExchange(keyData);
          // Respond with our key if we haven't already
          if (!this.sharedKey) {
            await this.sendPublicKey();
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
              progress: 0,
              speed: 0,
              status: 'transferring',
            },
          });
        }
        break;

      case 'file-chunk':
        if (message.fileId && message.chunk) {
          const fileData = this.fileChunks.get(message.fileId);
          if (fileData) {
            try {
              // Decrypt chunk
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

              // Calculate progress
              const progress =
                (fileData.chunks.length / (message.totalChunks || 1)) * 100;
              fileData.meta.progress = progress;

              this.config.onFileProgress?.(
                message.fileId!,
                progress,
                0
              );
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

    this.config.onFileComplete?.(fileId, file);
    this.fileChunks.delete(fileId);
  }

  async sendFile(file: File): Promise<string> {
    const fileId = generateFileId();
    const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
    let sentChunks = 0;
    let lastTime = Date.now();
    let lastBytes = 0;

    // Send file metadata
    this.send({
      type: 'file-meta',
      fileId,
      fileName: file.name,
      fileSize: file.size,
      fileType: file.type,
    });

    // Read and send chunks
    const arrayBuffer = await file.arrayBuffer();

    for (let i = 0; i < totalChunks; i++) {
      const start = i * CHUNK_SIZE;
      const end = Math.min(start + CHUNK_SIZE, file.size);
      const chunk = arrayBuffer.slice(start, end);

      let encryptedChunk: ArrayBuffer;
      let iv: Uint8Array = new Uint8Array(0);

      if (this.sharedKey) {
        const encrypted = await encryptData(chunk, this.sharedKey);
        encryptedChunk = encrypted.ciphertext;
        iv = encrypted.iv;
      } else {
        encryptedChunk = chunk;
      }

      this.send({
        type: 'file-chunk',
        fileId,
        chunk: encryptedChunk,
        iv: Array.from(iv),
        chunkIndex: i,
        totalChunks,
      });

      sentChunks++;

      // Calculate speed
      const now = Date.now();
      const elapsed = (now - lastTime) / 1000;
      if (elapsed >= 0.5) {
        const bytesPerSecond = (sentChunks * CHUNK_SIZE - lastBytes) / elapsed;
        this.config.onFileProgress?.(fileId, (sentChunks / totalChunks) * 100, bytesPerSecond);
        lastTime = now;
        lastBytes = sentChunks * CHUNK_SIZE;
      }

      // Small delay to prevent overwhelming the connection
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    // Send completion message
    this.send({
      type: 'file-complete',
      fileId,
    });

    return fileId;
  }

  disconnect() {
    if (this.connection) {
      this.connection.close();
      this.connection = null;
    }
  }

  destroy() {
    this.disconnect();
    if (this.peer) {
      this.peer.destroy();
      this.peer = null;
    }
    this.myKeyPair = null;
    this.sharedKey = null;
    this.fileChunks.clear();
  }

  isConnected(): boolean {
    return this.connection?.open ?? false;
  }

  getPeerId(): string | null {
    return this.peer?.id ?? null;
  }
}

export const p2pService = new P2PService();
export default p2pService;
