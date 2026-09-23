import { useEffect, useRef, useCallback } from 'react';
import p2pService from '../services/p2pService';
import { useAppStore } from '../store/useAppStore';

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
  const initializedRef = useRef(false);

  // Use refs to ensure callbacks always read latest state from store
  const setConnectionRef = useRef(setConnection);
  const setPeerIdRef = useRef(setPeerId);
  const updateFileRef = useRef(updateFile);
  const addFileRef = useRef(addFile);

  useEffect(() => {
    setConnectionRef.current = setConnection;
    setPeerIdRef.current = setPeerId;
    updateFileRef.current = updateFile;
    addFileRef.current = addFile;
  });

  const initializeP2P = useCallback(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;

    p2pService.initialize({
      onPeerId: (id) => {
        setPeerIdRef.current(id);
        setConnectionRef.current({ status: 'connecting' });
      },
      onConnection: () => {
        console.log('P2P: onConnection callback fired');
        setConnectionRef.current({ status: 'connected' });
      },
      onDisconnect: () => {
        console.log('P2P: onDisconnect callback fired');
        setConnectionRef.current({ status: 'disconnected' });
      },
      onFileProgress: (fileId, progress, speed) => {
        updateFileRef.current(fileId, { progress, speed, status: 'transferring' });
      },
      onFileComplete: (fileId, file) => {
        updateFileRef.current(fileId, { status: 'completed', progress: 100 });
        downloadFile(file);
      },
      onError: (error) => {
        setConnectionRef.current({ status: 'error', error });
      },
    });
  }, []);

  const createRoom = useCallback(async () => {
    setConnection({ status: 'connecting' });
    try {
      const code = await p2pService.createRoom();
      setRoomCode(code);
      setIsHost(true);
      isHostRef.current = true;
      return code;
    } catch (error: any) {
      setConnection({ status: 'error', error: error.message });
      return null;
    }
  }, [setRoomCode, setIsHost, setConnection]);

  const joinRoom = useCallback(
    async (code: string) => {
      setRoomCode(code);
      setIsHost(false);
      isHostRef.current = false;
      setConnection({ status: 'connecting', roomCode: code });

      try {
        await p2pService.joinRoom(code);
      } catch (error: any) {
        setConnection({ status: 'error', error: error.message || 'Không thể kết nối đến phòng' });
      }
    },
    [setRoomCode, setIsHost, setConnection]
  );

  const sendFile = useCallback(
    async (file: File) => {
      const fileId = `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
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

      try {
        await p2pService.sendFiles([file]);
      } catch (error: any) {
        updateFile(fileId, { status: 'error' });
      }
      return fileId;
    },
    [addFile, updateFile]
  );

  const sendFiles = useCallback(
    async (items: (File | DataTransferItem)[]) => {
      // Thêm vào store
      const fileIds: string[] = [];
      const filesToProcess: File[] = [];

      for (const item of items) {
        let file: File | null = null;
        if (item instanceof File) {
          file = item;
        } else if (item instanceof DataTransferItem && item.kind === 'file') {
          file = item.getAsFile();
        }
        if (file) {
          const id = `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
          addFile({
            id,
            name: file.name,
            size: file.size,
            type: file.type,
            progress: 0,
            speed: 0,
            status: 'pending',
            encrypted: true,
          });
          fileIds.push(id);
          filesToProcess.push(file);
        }
      }

      try {
        await p2pService.sendFiles(filesToProcess);
      } catch (error: any) {
        console.error('Send files error:', error);
      }
      return fileIds;
    },
    [addFile]
  );

  const disconnect = useCallback(() => {
    p2pService.disconnect();
    setConnection({ status: 'disconnected' });
    setIsHost(false);
    isHostRef.current = false;
  }, [setConnection, setIsHost]);

  const destroy = useCallback(() => {
    p2pService.destroy();
    reset();
    initializedRef.current = false;
  }, [reset]);

  useEffect(() => {
    initializeP2P();
    return () => {
      p2pService.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    connection,
    roomCode,
    peerId: p2pService.getMySocketId(),
    files,
    isHost: isHostRef.current,
    createRoom,
    joinRoom,
    sendFile,
    sendFiles,
    disconnect,
    destroy,
    isConnected: p2pService.isPeerConnected(),
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
