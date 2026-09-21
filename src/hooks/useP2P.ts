import { useEffect, useRef, useCallback } from 'react';
import p2pService from '../services/p2pService';
import { useAppStore } from '../store/useAppStore';
import { generateRoomCode } from '../utils/room';

export function useP2P() {
  const {
    connection,
    setConnection,
    roomCode,
    setRoomCode,
    setPeerId,
    files,
    addFile,
    updateFile,
    setIsHost,
    reset,
  } = useAppStore();

  const isHostRef = useRef(false);
  const targetRoomCode = useRef<string | null>(null);

  const initializeP2P = useCallback(() => {
    p2pService.initialize({
      onPeerId: (id) => {
        setPeerId(id);
        setConnection({ status: 'connecting' });
      },
      onConnection: () => {
        setConnection({ status: 'connected' });
      },
      onDisconnect: () => {
        setConnection({ status: 'disconnected' });
      },
      onFileProgress: (fileId, progress, speed) => {
        updateFile(fileId, { progress, speed, status: 'transferring' });
      },
      onFileComplete: (fileId, file) => {
        updateFile(fileId, { status: 'completed', progress: 100 });
        downloadFile(file);
      },
      onError: (error) => {
        setConnection({ status: 'error', error });
      },
    });
  }, [setConnection, setPeerId, updateFile]);

  const createRoom = useCallback(() => {
    const code = generateRoomCode();
    setRoomCode(code);
    setIsHost(true);
    isHostRef.current = true;
    targetRoomCode.current = code;
    return code;
  }, [setRoomCode, setIsHost]);

  const joinRoom = useCallback(
    async (code: string) => {
      setRoomCode(code);
      setIsHost(false);
      isHostRef.current = false;
      targetRoomCode.current = code;

      // The host's peer ID is the room code in our simple implementation
      // In production, you'd use a signaling server to map codes to peer IDs
      setConnection({ status: 'connecting', roomCode: code });

      try {
        await p2pService.connect(code);
      } catch {
        setConnection({ status: 'error', error: 'Không thể kết nối đến phòng' });
      }
    },
    [setRoomCode, setIsHost, setConnection]
  );

  const sendFile = useCallback(
    async (file: File) => {
      const fileId = await p2pService.sendFile(file);
      addFile({
        id: fileId,
        name: file.name,
        size: file.size,
        type: file.type,
        progress: 0,
        speed: 0,
        status: 'pending',
        encrypted: true,
      });
      return fileId;
    },
    [addFile]
  );

  const disconnect = useCallback(() => {
    p2pService.disconnect();
    setConnection({ status: 'disconnected' });
  }, [setConnection]);

  const destroy = useCallback(() => {
    p2pService.destroy();
    reset();
  }, [reset]);

  useEffect(() => {
    initializeP2P();
    return () => {
      p2pService.destroy();
    };
  }, [initializeP2P]);

  return {
    connection,
    roomCode,
    peerId: p2pService.getPeerId(),
    files,
    isHost: isHostRef.current,
    createRoom,
    joinRoom,
    sendFile,
    disconnect,
    destroy,
    isConnected: p2pService.isConnected(),
  };
}

function downloadFile(file: File) {
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
