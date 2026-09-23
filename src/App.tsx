import { useCallback } from 'react';
import { useAppStore } from './store/useAppStore';
import { useP2P } from './hooks/useP2P';
import { FileDropzone } from './components/FileDropzone';
import { FileList } from './components/FileList';
import { JoinRoom } from './components/JoinRoom';
import { RoomCode } from './components/RoomCode';
import { ConnectionStatus } from './components/ConnectionStatus';
import type { FileTransfer } from './types';

type ViewType = 'home' | 'room' | 'connected';

function App() {
  const {
    connection,
    roomCode,
    files,
    removeFile,
    setView: setStoreView,
    view: storeView,
    reset,
  } = useAppStore();

  // Dùng P2P hook
  const {
    createRoom,
    joinRoom,
    sendFiles,
    disconnect,
  } = useP2P();

  const view = (storeView as ViewType) || 'home';

  // Tạo phòng
  const handleCreateRoom = useCallback(async () => {
    const code = await createRoom();
    if (code) {
      setStoreView('room');
    }
  }, [createRoom, setStoreView]);

  // Tham gia phòng
  const handleJoinRoom = useCallback(async (code: string) => {
    await joinRoom(code);
    setStoreView('room');
  }, [joinRoom, setStoreView]);

  // Xử lý file được chọn
  const handleFilesSelected = useCallback(async (items: (File | DataTransferItem)[]) => {
    await sendFiles(items);
  }, [sendFiles]);

  // Rời phòng
  const handleLeave = useCallback(() => {
    disconnect();
    reset();
    setStoreView('home');
  }, [disconnect, reset, setStoreView]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900">
      <div className="container mx-auto px-4 py-8 max-w-4xl">
        {/* Header */}
        <header className="flex items-center justify-between mb-12">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-gradient-to-br from-primary-500 to-primary-600 rounded-xl flex items-center justify-center shadow-lg">
              <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
              </svg>
            </div>
            <div>
              <h1 className="text-2xl font-bold text-gray-900 dark:text-white">FileBridge</h1>
              <p className="text-sm text-gray-500 dark:text-gray-400">Chuyển file P2P bảo mật</p>
            </div>
          </div>

          <ConnectionStatus connection={connection} />
        </header>

        {/* Main Content */}
        <main>
          {view === 'home' && (
            <HomeView
              onCreateRoom={handleCreateRoom}
              onJoinRoom={handleJoinRoom}
              error={connection.error || undefined}
            />
          )}

          {view === 'room' && (
            <RoomView
              roomCode={roomCode || ''}
              isConnected={connection.status === 'connected'}
              files={files}
              onSendFiles={handleFilesSelected}
              onRemoveFile={removeFile}
              onLeave={handleLeave}
            />
          )}

          {view === 'connected' && (
            <ConnectedView
              files={files}
              onSendFiles={handleFilesSelected}
              onRemoveFile={removeFile}
              onDisconnect={disconnect}
              onLeave={handleLeave}
            />
          )}
        </main>

        {/* Footer */}
        <footer className="mt-16 text-center text-sm text-gray-400 dark:text-gray-500">
          <p>Mã hóa E2E AES-256-GCM • Không qua server trung gian</p>
        </footer>
      </div>
    </div>
  );
}

interface HomeViewProps {
  onCreateRoom: () => void;
  onJoinRoom: (code: string) => void;
  error?: string;
}

function HomeView({ onCreateRoom, onJoinRoom, error }: HomeViewProps) {
  return (
    <div className="space-y-8">
      <div className="text-center">
        <h2 className="text-3xl font-bold text-gray-900 dark:text-white mb-3">
          Chia sẻ file an toàn
        </h2>
        <p className="text-gray-600 dark:text-gray-400 max-w-2xl mx-auto">
          Truyền file trực tiếp giữa các thiết bị với mã hóa đầu cuối.
          Không lưu trữ trên server, không giới hạn kích thước.
        </p>
      </div>

      {error && (
        <div className="max-w-2xl mx-auto p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl">
          <p className="text-red-700 dark:text-red-400 text-sm">{error}</p>
        </div>
      )}

      <div className="grid md:grid-cols-2 gap-6 max-w-2xl mx-auto">
        <div className="bg-white dark:bg-gray-800 p-8 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 text-center">
          <div className="w-12 h-12 bg-primary-100 dark:bg-primary-900/30 rounded-xl flex items-center justify-center text-primary-600 dark:text-primary-400 mb-4 mx-auto">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
          </div>
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">Tạo phòng mới</h3>
          <p className="text-gray-600 dark:text-gray-400 text-sm mb-4">
            Tạo phòng và chia sẻ mã với người muốn nhận file
          </p>
          <button
            onClick={onCreateRoom}
            className="w-full py-3 px-6 bg-primary-500 hover:bg-primary-600 text-white font-medium rounded-xl transition-colors"
          >
            Tạo phòng
          </button>
        </div>

        <div className="bg-white dark:bg-gray-800 p-8 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700">
          <JoinRoom onJoin={onJoinRoom} />
        </div>
      </div>

      <Features />
    </div>
  );
}

function Features() {
  return (
    <div className="grid md:grid-cols-3 gap-4 max-w-4xl mx-auto mt-12">
      <FeatureCard
        icon={
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
          </svg>
        }
        title="Mã hóa đầu cuối"
        description="AES-256-GCM, key chỉ có sender và receiver biết"
      />
      <FeatureCard
        icon={
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9.78 2.096A4.001 4.001 0 003 15z" />
          </svg>
        }
        title="Không qua server"
        description="File đi thẳng giữa 2 thiết bị, không lưu trữ"
      />
      <FeatureCard
        icon={
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
        }
        title="Tốc độ cao"
        description="P2P direct transfer, không upload/download qua cloud"
      />
    </div>
  );
}

function FeatureCard({ icon, title, description }: { icon: React.ReactNode; title: string; description: string }) {
  return (
    <div className="bg-white dark:bg-gray-800 p-6 rounded-xl border border-gray-100 dark:border-gray-700">
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
  isConnected: boolean;
  files: FileTransfer[];
  onSendFiles: (items: (File | DataTransferItem)[]) => void;
  onRemoveFile: (id: string) => void;
  onLeave: () => void;
}

function RoomView({ roomCode, isConnected, files, onSendFiles, onRemoveFile, onLeave }: RoomViewProps) {
  return (
    <div className="space-y-8">
      <div className="text-center">
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
          {isConnected ? 'Đã kết nối!' : 'Đang chờ người tham gia...'}
        </h2>
        <p className="text-gray-600 dark:text-gray-400">
          {isConnected ? 'Bạn có thể gửi file ngay bây giờ' : 'Chia sẻ mã phòng với người muốn nhận file'}
        </p>
      </div>

      <RoomCode code={roomCode} isHost={true} />

      {isConnected && (
        <>
          <FileDropzone onFilesSelected={onSendFiles} disabled={false} />
          <FileList files={files} onRemove={onRemoveFile} />
        </>
      )}

      <div className="text-center">
        <button
          onClick={onLeave}
          className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 transition-colors"
        >
          Rời phòng
        </button>
      </div>
    </div>
  );
}

interface ConnectedViewProps {
  files: FileTransfer[];
  onSendFiles: (items: (File | DataTransferItem)[]) => void;
  onRemoveFile: (id: string) => void;
  onDisconnect: () => void;
  onLeave: () => void;
}

function ConnectedView({ files, onSendFiles, onRemoveFile, onDisconnect, onLeave }: ConnectedViewProps) {
  return (
    <div className="space-y-8">
      <div className="text-center">
        <div className="inline-flex items-center gap-2 px-4 py-2 bg-green-100 dark:bg-green-900/30 rounded-full text-green-700 dark:text-green-400 mb-4">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
          <span className="font-medium">Đã kết nối P2P thành công!</span>
        </div>
      </div>

      <FileDropzone onFilesSelected={onSendFiles} disabled={false} />
      <FileList files={files} onRemove={onRemoveFile} />

      <div className="flex justify-center gap-4">
        <button
          onClick={onDisconnect}
          className="text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 transition-colors"
        >
          Ngắt kết nối
        </button>
        <button
          onClick={onLeave}
          className="text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 transition-colors"
        >
          Rời phòng
        </button>
      </div>
    </div>
  );
}

export default App;
