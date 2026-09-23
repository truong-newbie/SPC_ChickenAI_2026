import { create } from 'zustand';
import type { FileTransfer, ConnectionState } from '../types';

interface AppState {
  // Connection state
  connection: ConnectionState;
  setConnection: (connection: Partial<ConnectionState>) => void;

  // Room
  roomCode: string | null;
  setRoomCode: (code: string | null) => void;

  // Peer ID
  peerId: string | null;
  setPeerId: (id: string | null) => void;

  // Files
  files: FileTransfer[];
  addFile: (file: FileTransfer) => void;
  updateFile: (id: string, updates: Partial<FileTransfer>) => void;
  removeFile: (id: string) => void;
  clearFiles: () => void;

  // UI State
  isHost: boolean;
  setIsHost: (isHost: boolean) => void;
  view: string;
  setView: (view: string) => void;

  // Actions
  reset: () => void;
}

const initialConnection: ConnectionState = {
  status: 'disconnected',
  peerId: null,
  roomCode: null,
  error: null,
};

export const useAppStore = create<AppState>((set) => ({
  // Connection
  connection: initialConnection,
  setConnection: (updates) =>
    set((state) => ({
      connection: { ...state.connection, ...updates },
    })),

  // Room
  roomCode: null,
  setRoomCode: (code) => set({ roomCode: code }),

  // Peer ID
  peerId: null,
  setPeerId: (id) => set({ peerId: id }),

  // Files
  files: [],
  addFile: (file) =>
    set((state) => ({
      files: [...state.files, file],
    })),
  updateFile: (id, updates) =>
    set((state) => ({
      files: state.files.map((f) => (f.id === id ? { ...f, ...updates } : f)),
    })),
  removeFile: (id) =>
    set((state) => ({
      files: state.files.filter((f) => f.id !== id),
    })),
  clearFiles: () => set({ files: [] }),

  // UI State
  isHost: false,
  setIsHost: (isHost) => set({ isHost }),
  view: 'home',
  setView: (view) => set({ view }),

  // Reset
  reset: () =>
    set({
      connection: initialConnection,
      roomCode: null,
      peerId: null,
      files: [],
      isHost: false,
      view: 'home',
    }),
}));
