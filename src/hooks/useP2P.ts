import { useEffect, useRef, useCallback, useState } from 'react';
import { p2pService } from '../services/p2pService';
import { useAppStore } from '../store/useAppStore';
import { ReceivedFile } from '../lib/transfer/receiver';
import { formatSpeed, formatEta } from '../lib/transfer/protocol';

// Helper for direct downloads (also exposed via ReceivedFilesPanel)

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
  const updateFileRef = useRef(updateFile);
  const addFileRef = useRef(addFile);
  const filesRef = useRef(files);
  const sendingFileRef = useRef<string | null>(null);

  useEffect(() => {
    setConnectionRef.current = setConnection;
    setRoomCodeRef.current = setRoomCode;
    setIsHostRef.current = setIsHost;
    updateFileRef.current = updateFile;
    addFileRef.current = addFile;
    filesRef.current = files;
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
        window.dispatchEvent(new CustomEvent('p2p-files-received', { detail: receivedFiles }));
      },
      onFileStart: (index, total, fileName, fileSize) => {
        console.log(`P2P: sending file ${index + 1}/${total}: ${fileName} (${fileSize} bytes)`);
        // Update file status to transferring
        const fileInStore = filesRef.current.find(f => f.name === fileName);
        if (fileInStore) {
          updateFileRef.current(fileInStore.id, { status: 'transferring', progress: 0, size: fileSize });
        }
      },
      onProgress: (percent, _received, _total) => {
        // Find file by current name being sent
        const sendingFileName = sendingFileRef.current;
        if (sendingFileName) {
          const fileInStore = filesRef.current.find(f => f.name === sendingFileName);
          if (fileInStore) {
            updateFileRef.current(fileInStore.id, { progress: percent });
          }
        }
      },
      onSpeed: (bytesPerSec, etaSeconds) => {
        setSpeed(formatSpeed(bytesPerSec));
        setEta(formatEta(etaSeconds));
        // Update file speed
        const sendingFileName = sendingFileRef.current;
        if (sendingFileName) {
          const fileInStore = filesRef.current.find(f => f.name === sendingFileName);
          if (fileInStore) {
            updateFileRef.current(fileInStore.id, { speed: bytesPerSec });
          }
        }
      },
      onFileComplete: (file, _index, _total) => {
        console.log(`P2P: file complete ${file.fileName}`);
        const fileInStore = filesRef.current.find(f => f.name === file.fileName);
        if (fileInStore) {
          updateFileRef.current(fileInStore.id, {
            status: 'completed',
            progress: 100,
          });
        }
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

  const joinRoom = useCallback(async (code?: string) => {
    setRoomCodeRef.current(code || null);
    setIsHostRef.current(false);
    isHostRef.current = false;
    setConnectionRef.current({ status: 'connecting' });

    try {
      // joinRoom gets room from URL fragment internally
      await p2pService.joinRoom();
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

    // Send files one by one so we can track which one is sending
    for (let i = 0; i < filesToProcess.length; i++) {
      const file = filesToProcess[i];
      sendingFileRef.current = file.name;
      try {
        await p2pService.sendFiles([file]);
        const id = fileIds[i];
        updateFile(id, { status: 'completed', progress: 100 });
      } catch (error: any) {
        console.error('Send file error:', error);
        const id = fileIds[i];
        updateFile(id, { status: 'error' });
      }
    }
    sendingFileRef.current = null;
    return fileIds;
  }, [addFile, updateFile]);

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

    // Auto-join if URL has room fragment
    const hash = window.location.hash;
    const match = hash.match(/[#&]?room=([^&]+)/);
    if (match) {
      const roomId = match[1];
      console.log('[P2P] Auto-joining room:', roomId);
      joinRoom(roomId);
    }

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
