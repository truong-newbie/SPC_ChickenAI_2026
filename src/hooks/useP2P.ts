import { useEffect, useRef, useCallback, useState } from 'react';
import { p2pService } from '../services/p2pService';
import { useAppStore } from '../store/useAppStore';
import { ReceivedFile } from '../lib/transfer/receiver';
import { formatSpeed, formatEta } from '../lib/transfer/protocol';

export function useP2P() {
  const {
    connection,
    setConnection,
    roomCode,
    setRoomCode,
    files,
    addFile,
    updateFile,
    setIsHost,
    reset,
  } = useAppStore();

  const isHostRef = useRef(false);
  const initializedRef = useRef(false);
  const [speed, setSpeed] = useState<string>('');
  const [eta, setEta] = useState<string>('');

  // Refs to avoid stale closures
  const setConnectionRef = useRef(setConnection);
  const setRoomCodeRef = useRef(setRoomCode);
  const setIsHostRef = useRef(setIsHost);

  useEffect(() => {
    setConnectionRef.current = setConnection;
    setRoomCodeRef.current = setRoomCode;
    setIsHostRef.current = setIsHost;
  });

  const initializeP2P = useCallback(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;

    p2pService.initialize({
      onConnection: () => {
        console.log('P2P: connected');
        setConnectionRef.current({ status: 'connected' });
      },
      onDisconnect: () => {
        console.log('P2P: disconnected');
        setConnectionRef.current({ status: 'disconnected' });
      },
      onStatusChange: (status) => {
        console.log('P2P: status change to', status);
        setConnectionRef.current({ status: status as any });
      },
      onError: (error) => {
        console.error('P2P: error', error);
        setConnectionRef.current({ status: 'error', error });
      },
      onFilesReceived: (receivedFiles: ReceivedFile[]) => {
        console.log('P2P: received files', receivedFiles.length);
        receivedFiles.forEach((rf) => {
          downloadFile(rf);
        });
      },
      onFileStart: (index, total, fileName) => {
        console.log(`P2P: receiving file ${index + 1}/${total}: ${fileName}`);
      },
      onProgress: (_percent, _received, _total) => {
        // Progress update - unused for now
      },
      onSpeed: (bytesPerSec, etaSeconds) => {
        setSpeed(formatSpeed(bytesPerSec));
        setEta(formatEta(etaSeconds));
      },
      onTransferComplete: () => {
        console.log('P2P: transfer complete');
        setSpeed('');
        setEta('');
      },
    });
  }, []);

  const createRoom = useCallback(async () => {
    setConnectionRef.current({ status: 'connecting' });
    try {
      const code = await p2pService.createRoom();
      setRoomCodeRef.current(code);
      setIsHostRef.current(true);
      isHostRef.current = true;
      return code;
    } catch (error: any) {
      setConnectionRef.current({ status: 'error', error: error.message });
      return null;
    }
  }, []);

  const joinRoom = useCallback(async (code: string) => {
    setRoomCodeRef.current(code);
    setIsHostRef.current(false);
    isHostRef.current = false;
    setConnectionRef.current({ status: 'connecting' });

    try {
      await p2pService.joinRoom(code);
    } catch (error: any) {
      setConnectionRef.current({ status: 'error', error: error.message || 'Không thể kết nối đến phòng' });
    }
  }, []);

  const sendFile = useCallback(async (file: File) => {
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
  }, [addFile, updateFile]);

  const sendFiles = useCallback(async (items: (File | DataTransferItem)[]) => {
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
  }, [addFile]);

  const disconnect = useCallback(() => {
    p2pService.disconnect();
    setConnectionRef.current({ status: 'disconnected' });
    setIsHostRef.current(false);
    isHostRef.current = false;
  }, []);

  const destroy = useCallback(() => {
    p2pService.disconnect();
    reset();
    initializedRef.current = false;
  }, [reset]);

  useEffect(() => {
    initializeP2P();
    return () => {
      p2pService.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    connection,
    roomCode,
    files,
    isHost: isHostRef.current,
    speed,
    eta,
    createRoom,
    joinRoom,
    sendFile,
    sendFiles,
    disconnect,
    destroy,
    isConnected: p2pService.isConnectedToPeer(),
  };
}

function downloadFile(rf: ReceivedFile) {
  const url = URL.createObjectURL(rf.blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = rf.fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
