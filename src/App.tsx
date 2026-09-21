import React, { useState, useCallback, useEffect } from 'react';
import { FileDropzone } from './components/FileDropzone';
import { FileList } from './components/FileList';
import { RoomCode } from './components/RoomCode';
import { JoinRoom } from './components/JoinRoom';
import { ConnectionStatus } from './components/ConnectionStatus';
import { useAppStore } from './store/useAppStore';
import p2pService from './services/p2pService';
import { generateRoomCode } from './utils/room';
import type { FileTransfer } from './types';

type View = 'home' | 'room' | 'connected';

function App() {
  const [view, setView] = useState<View>('home');
  const {
    connection,
    roomCode,
    setRoomCode,
    files,
    addFile,
    removeFile,
    setConnection,
    setIsHost,
    reset,
  } = useAppStore();

  const [peerId, setPeerId] = useState<string | null>(null);
  const [isHost, setIsHostState] = useState(false);

  const initializeP2P = useCallback(() => {
    p2pService.initialize({
      onPeerId: (id) => {
        setPeerId(id);
        setConnection({ status: 'connecting' });
      },
      onConnection: () => {
        setConnection({ status: 'connected' });
        setView('connected');
      },
      onDisconnect: () => {
        setConnection({ status: 'disconnected' });
      },
      onFileProgress: (fileId, progress, speed) => {
        useAppStore.getState().updateFile(fileId, { progress, speed, status: 'transferring' });
      },
      onFileComplete: (fileId, file) => {
        useAppStore.getState().updateFile(fileId, { status: 'completed', progress: 100 });
        downloadFile(file);
      },
      onError: (error) => {
        setConnection({ status: 'error', error });
      },
    });
  }, [setConnection]);

  const createRoom = useCallback(() => {
    const code = generateRoomCode();
    setRoomCode(code);
    setIsHostState(true);
    setIsHost(true);
    setView('room');

    // Wait for peer ID then connect
    setTimeout(() => {
      if (peerId) {
        p2pService.connect(peerId).catch(console.error);
      }
    }, 1000);
  }, [peerId, setRoomCode, setIsHost]);

  const joinRoom = useCallback(async (code: string) => {
    setRoomCode(code);
    setIsHostState(false);
    setIsHost(false);
    setConnection({ status: 'connecting', roomCode: code });

    try {
      await p2pService.connect(code);
    } catch {
      setConnection({ status: 'error', error: 'Không thể kết nối đến phòng' });
    }
  }, [setRoomCode, setConnection, setIsHost]);

  const handleFilesSelected = useCallback(async (selectedFiles: File[]) => {
    for (const file of selectedFiles) {
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
    }
  }, [addFile]);

  const handleLeave = useCallback(() => {
    p2pService.destroy();
    reset();
    setView('home');
    setPeerId(null);
    setIsHostState(false);
    initializeP2P();
  }, [reset, initializeP2P]);

  const handleDisconnect = useCallback(() => {
    p2pService.disconnect();
    setConnection({ status: 'disconnected' });
    setView('room');
  }, [setConnection]);

  // Initialize P2P on mount
  useEffect(() => {
    initializeP2P();
    return () => {
      p2pService.destroy();
    };
  }, [initializeP2P]);

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      {/* Header */}
      <header className="bg-white dark:bg-gray-800 shadow-sm border-b border-gray-200 dark:border-gray-700">
        <div className="max-w-4xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-gradient-to-br from-primary-500 to-blue-600 rounded-xl flex items-center justify-center shadow-lg shadow-primary-500/25">
                <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
                </svg>
              </div>
              <div>
                <h1 className="text-xl font-bold text-gray-900 dark:text-white">FileBridge</h1>
                <p className="text-xs text-gray-500 dark:text-gray-400">Chuyển file P2P bảo mật</p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <ConnectionStatus connection={connection} />
              {view !== 'home' && (
                <button
                  onClick={handleLeave}
                  className="px-3 py-1.5 text-sm font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
                >
                  Thoát
                </button>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-4xl mx-auto px-4 py-8">
        {/* Security Badge */}
        <div className="mb-8 flex items-center justify-center gap-2 text-sm text-gray-500 dark:text-gray-400">
          <svg className="w-4 h-4 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
          </svg>
          <span>Mã hóa E2E AES-256-GCM • Không qua server trung gian</span>
        </div>

        {view === 'home' && (
          <HomeView
            onCreateRoom={createRoom}
            onJoinRoom={joinRoom}
          />
        )}

        {view === 'room' && roomCode && (
          <RoomView
            roomCode={roomCode}
            peerId={peerId}
            isHost={isHost}
            onConnect={handleFilesSelected}
            files={files}
            onRemoveFile={removeFile}
            onDisconnect={handleDisconnect}
          />
        )}

        {view === 'connected' && roomCode && (
          <ConnectedView
            onSendFiles={handleFilesSelected}
            files={files}
            onRemoveFile={removeFile}
          />
        )}
      </main>

      {/* Footer */}
      <footer className="mt-auto py-6 text-center text-sm text-gray-400 dark:text-gray-500">
        <p>FileBridge • Không lưu trữ file trên server</p>
      </footer>
    </div>
  );
}

interface HomeViewProps {
  onCreateRoom: () => void;
  onJoinRoom: (code: string) => void;
}

function HomeView({ onCreateRoom, onJoinRoom }: HomeViewProps) {
  const [showJoin, setShowJoin] = useState(false);

  return (
    <div className="space-y-8">
      {/* Hero Section */}
      <div className="text-center py-8">
        <h2 className="text-3xl font-bold text-gray-900 dark:text-white mb-4">
          Chuyển file an toàn, không giới hạn
        </h2>
        <p className="text-lg text-gray-600 dark:text-gray-300 max-w-2xl mx-auto">
          FileBridge sử dụng công nghệ P2P với mã hóa đầu cuối. File được chuyển trực tiếp từ thiết bị của bạn đến người nhận — không qua bất kỳ server trung gian nào.
        </p>
      </div>

      {/* Action Buttons */}
      <div className="flex flex-col sm:flex-row gap-4 justify-center">
        <button
          onClick={onCreateRoom}
          className="
            flex-1 max-w-sm mx-auto sm:mx-0 sm:flex-initial
            px-8 py-4 rounded-2xl font-semibold text-lg
            bg-gradient-to-r from-primary-500 to-blue-600
            text-white shadow-lg shadow-primary-500/25
            hover:shadow-xl hover:shadow-primary-500/30
            transform hover:-translate-y-0.5
            transition-all duration-200
          "
        >
          <span className="flex items-center justify-center gap-2">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Tạo phòng mới
          </span>
        </button>

        <button
          onClick={() => setShowJoin(!showJoin)}
          className="
            flex-1 max-w-sm mx-auto sm:mx-0 sm:flex-initial
            px-8 py-4 rounded-2xl font-semibold text-lg
            bg-white dark:bg-gray-800
            text-gray-700 dark:text-gray-200
            border-2 border-gray-200 dark:border-gray-700
            hover:border-primary-300 dark:hover:border-primary-600
            transition-all duration-200
          "
        >
          <span className="flex items-center justify-center gap-2">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1" />
            </svg>
            Tham gia phòng
          </span>
        </button>
      </div>

      {/* Join Form */}
      {showJoin && (
        <div className="max-w-md mx-auto">
          <JoinRoom onJoin={onJoinRoom} />
        </div>
      )}

      {/* Features Grid */}
      <div className="grid md:grid-cols-3 gap-6 mt-12">
        <FeatureCard
          icon={
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
          }
          title="Mã hóa E2E"
          description="AES-256-GCM với ECDH key exchange. Chỉ người gửi và người nhận mới có thể đọc file."
        />
        <FeatureCard
          icon={
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          }
          title="Tốc độ cao"
          description="Chuyển file trực tiếp P2P, không giới hạn kích thước, không qua server trung gian."
        />
        <FeatureCard
          icon={
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          }
          title="Cross-Network"
          description="Hoạt động qua Internet toàn cầu, không chỉ cùng mạng LAN."
        />
      </div>
    </div>
  );
}

function FeatureCard({ icon, title, description }: { icon: React.ReactNode; title: string; description: string }) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl p-6 border border-gray-200 dark:border-gray-700 hover:border-primary-200 dark:hover:border-primary-800 transition-colors">
      <div className="w-12 h-12 bg-primary-100 dark:bg-primary-900/30 rounded-xl flex items-center justify-center text-primary-600 dark:text-primary-400 mb-4">
        {icon}
      </div>
      <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">{title}</h3>
      <p className="text-gray-600 dark:text-gray-400 text-sm">{description}</p>
    </div>
  );
}

interface RoomViewProps {
  roomCode: string;
  peerId: string | null;
  isHost: boolean;
  onConnect: (files: File[]) => void;
  files: FileTransfer[];
  onRemoveFile: (id: string) => void;
  onDisconnect: () => void;
}

function RoomView({ roomCode, peerId, isHost, onConnect, files, onRemoveFile, onDisconnect }: RoomViewProps) {
  return (
    <div className="space-y-8">
      <div className="text-center">
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
          {isHost ? 'Phòng của bạn đã sẵn sàng' : 'Đang chờ kết nối...'}
        </h2>
        <p className="text-gray-600 dark:text-gray-400">
          {isHost ? 'Chia sẻ mã phòng với người muốn nhận file' : 'Nhập mã phòng để tham gia'}
        </p>
      </div>

      <RoomCode code={roomCode} peerId={peerId} isHost={isHost} />

      {isHost && (
        <div className="space-y-6">
          <FileDropzone onFilesSelected={onConnect} disabled={false} />
          <FileList files={files} onRemove={onRemoveFile} />
        </div>
      )}

      {!isHost && (
        <div className="text-center py-8">
          <div className="animate-pulse">
            <div className="w-16 h-16 mx-auto bg-primary-100 dark:bg-primary-900/30 rounded-full flex items-center justify-center">
              <svg className="w-8 h-8 text-primary-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
            </div>
          </div>
          <p className="mt-4 text-gray-500 dark:text-gray-400">
            Đang đợi host chia sẻ file...
          </p>
        </div>
      )}

      <div className="text-center">
        <button
          onClick={onDisconnect}
          className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 transition-colors"
        >
          Hủy kết nối
        </button>
      </div>
    </div>
  );
}

interface ConnectedViewProps {
  onSendFiles: (files: File[]) => void;
  files: FileTransfer[];
  onRemoveFile: (id: string) => void;
}

function ConnectedView({ onSendFiles, files, onRemoveFile }: ConnectedViewProps) {
  return (
    <div className="space-y-8">
      <div className="text-center">
        <div className="inline-flex items-center gap-2 px-4 py-2 bg-green-100 dark:bg-green-900/30 rounded-full text-green-700 dark:text-green-400 mb-4">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
          <span className="font-medium">Đã kết nối P2P thành công!</span>
        </div>
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
          Sẵn sàng chuyển file
        </h2>
        <p className="text-gray-600 dark:text-gray-400">
          Kéo thả file vào khung bên dưới để gửi
        </p>
      </div>

      <FileDropzone onFilesSelected={onSendFiles} disabled={false} />
      <FileList files={files} onRemove={onRemoveFile} />
    </div>
  );
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

export default App;
