import React, { useState } from 'react';

interface RoomCodeProps {
  code: string;
  peerId?: string | null;
  isHost: boolean;
  onCopy?: () => void;
}

export const RoomCode: React.FC<RoomCodeProps> = ({
  code,
  peerId,
  isHost,
  onCopy,
}) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    const textToCopy = peerId ? `FileBridge: ${code}\nPeer ID: ${peerId}` : code;
    try {
      await navigator.clipboard.writeText(textToCopy);
      setCopied(true);
      onCopy?.();
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  return (
    <div className="bg-gradient-to-br from-primary-50 to-blue-50 dark:from-primary-900/30 dark:to-blue-900/30 rounded-2xl p-6 border border-primary-100 dark:border-primary-800">
      <div className="text-center">
        <p className="text-sm font-medium text-primary-600 dark:text-primary-400 mb-2">
          {isHost ? 'Mã phòng của bạn' : 'Đang tham gia phòng'}
        </p>

        <div className="flex items-center justify-center gap-3 mb-4">
          {code.split('').map((char, index) => (
            <div
              key={index}
              className="w-12 h-14 bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-primary-200 dark:border-primary-700 flex items-center justify-center"
            >
              <span className="text-2xl font-bold text-primary-600 dark:text-primary-400">
                {char}
              </span>
            </div>
          ))}
        </div>

        {peerId && isHost && (
          <div className="mb-4 p-3 bg-white/50 dark:bg-gray-800/50 rounded-xl">
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">Peer ID của bạn</p>
            <p className="text-sm font-mono text-gray-700 dark:text-gray-300 break-all">
              {peerId}
            </p>
          </div>
        )}

        <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
          {isHost
            ? 'Chia sẻ mã phòng này để người khác tham gia'
            : 'Đang chờ kết nối...'}
        </p>

        <button
          onClick={handleCopy}
          className={`
            inline-flex items-center gap-2 px-4 py-2 rounded-xl font-medium text-sm
            transition-all duration-200
            ${copied
              ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
              : 'bg-primary-500 text-white hover:bg-primary-600 active:scale-95'
            }
          `}
        >
          {copied ? (
            <>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              Đã sao chép!
            </>
          ) : (
            <>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
              Sao chép mã phòng
            </>
          )}
        </button>
      </div>
    </div>
  );
};

export default RoomCode;
