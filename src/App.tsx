import { useCallback, useState, useEffect } from 'react';
import { useAppStore } from './store/useAppStore';
import { useP2P } from './hooks/useP2P';
import { FileDropzone } from './components/FileDropzone';
import { FileList } from './components/FileList';
import { ShareLinkPanel } from './components/ShareLinkPanel';
import { ConnectionStatus } from './components/ConnectionStatus';
import { ReceivedFilesPanel } from './components/ReceivedFilesPanel';
import type { FileTransfer } from './types';

function App() {
  const {
    connection,
    files,
    removeFile,
    setView: setStoreView,
    view: storeView,
    reset,
    setShareLink,
    shareLink,
  } = useAppStore();

  const {
    createRoom,
    sendFiles,
    disconnect,
    isConnected,
  } = useP2P();

  const view = (storeView as string) || 'home';

  // Create room and get share link
  const handleCreateRoom = useCallback(async () => {
    const link = await createRoom();
    if (link) {
      setShareLink(link);
      setStoreView('sender');
    }
  }, [createRoom, setShareLink, setStoreView]);

  // Handle file selection
  const handleFilesSelected = useCallback(async (items: (File | DataTransferItem)[]) => {
    await sendFiles(items);
  }, [sendFiles]);

  // Leave room
  const handleLeave = useCallback(() => {
    disconnect();
    reset();
    setStoreView('home');
  }, [disconnect, reset, setStoreView]);

  // Copy link
  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(shareLink || '');
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [shareLink]);

  // Auto-detect role from URL on mount
  useEffect(() => {
    const hash = window.location.hash;
    if (hash.includes('room=')) {
      // Has room in URL = receiver mode
      setStoreView('receiver');
    }
  }, [setStoreView]);

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
              <p className="text-sm text-gray-500 dark:text-gray-400">Chia sẻ file P2P bảo mật</p>
            </div>
          </div>

          <ConnectionStatus connection={connection} />
        </header>

        {/* Main Content */}
        <main>
          {view === 'home' && (
            <HomeView
              onCreateRoom={handleCreateRoom}
              error={connection.error || undefined}
            />
          )}

          {view === 'sender' && (
            <SenderView
              shareLink={shareLink || ''}
              isConnected={isConnected}
              files={files}
              onCopy={handleCopy}
              copied={copied}
              onSendFiles={handleFilesSelected}
              onRemoveFile={removeFile}
              onLeave={handleLeave}
            />
          )}

          {view === 'receiver' && (
            <ReceiverView
              isConnected={isConnected}
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
  error?: string;
}

function HomeView({ onCreateRoom, error }: HomeViewProps) {
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

      <div className="text-center">
        <button
          onClick={onCreateRoom}
          className="px-8 py-4 bg-primary-500 hover:bg-primary-600 text-white font-medium rounded-xl transition-colors text-lg shadow-lg hover:shadow-xl"
        >
          Tạo link chia sẻ
        </button>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-3">
          Chọn file và tạo link để chia sẻ với người nhận
        </p>
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

interface SenderViewProps {
  shareLink: string;
  isConnected: boolean;
  files: FileTransfer[];
  copied: boolean;
  onCopy: () => void;
  onSendFiles: (items: (File | DataTransferItem)[]) => void;
  onRemoveFile: (id: string) => void;
  onLeave: () => void;
}

function SenderView({
  shareLink,
  isConnected,
  files,
  copied,
  onCopy,
  onSendFiles,
  onRemoveFile,
  onLeave,
}: SenderViewProps) {
  return (
    <div className="space-y-6">
      <div className="text-center">
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
          {isConnected ? '✅ Đã kết nối!' : '⏳ Đang chờ người nhận...'}
        </h2>
        <p className="text-gray-600 dark:text-gray-400">
          {isConnected
            ? 'Chọn file để gửi'
            : 'Chia sẻ link bên dưới với người nhận'}
        </p>
      </div>

      {/* Share Link Panel */}
      <ShareLinkPanel link={shareLink} onCopy={onCopy} copied={copied} />

      {/* File Selection */}
      <FileDropzone onFilesSelected={onSendFiles} disabled={false} />

      {/* File List */}
      <FileList files={files} onRemove={onRemoveFile} />

      {/* Leave Button */}
      <div className="text-center pt-4">
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

interface ReceiverViewProps {
  isConnected: boolean;
  onLeave: () => void;
}

function ReceiverView({ isConnected, onLeave }: ReceiverViewProps) {
  return (
    <div className="space-y-6">
      <div className="text-center">
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
          {isConnected ? '🔗 Đã kết nối' : '⏳ Đang kết nối...'}
        </h2>
        <p className="text-gray-600 dark:text-gray-400">
          {isConnected
            ? 'Đang nhận file từ người gửi'
            : 'Vui lòng chờ người gửi kết nối'}
        </p>
      </div>

      {/* Received Files Panel */}
      <ReceivedFilesPanel />

      {/* Leave Button */}
      <div className="text-center pt-4">
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

export default App;
