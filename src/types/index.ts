export interface FileTransfer {
  id: string;
  name: string;
  size: number;
  type: string;
  progress: number;
  speed: number;
  status: 'pending' | 'transferring' | 'completed' | 'error';
  encrypted?: boolean;
}

export interface RoomInfo {
  code: string;
  peerId: string;
  isHost: boolean;
  createdAt: number;
}

export interface PeerMessage {
  type: 'file-meta' | 'file-chunk' | 'file-complete' | 'text';
  fileId?: string;
  fileName?: string;
  fileSize?: number;
  fileType?: string;
  chunk?: ArrayBuffer;
  chunkIndex?: number;
  totalChunks?: number;
  text?: string;
  progress?: number;
  iv?: number[];
}

export interface ConnectionState {
  status: 'disconnected' | 'connecting' | 'connected' | 'error';
  peerId: string | null;
  roomCode: string | null;
  error: string | null;
}

export interface TransferProgress {
  fileId: string;
  fileName: string;
  progress: number;
  speed: number;
  transferred: number;
  total: number;
}

export interface EncryptedChunk {
  data: ArrayBuffer;
  iv: Uint8Array;
  index: number;
  totalChunks: number;
}
