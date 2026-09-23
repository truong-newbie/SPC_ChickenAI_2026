import { useEffect, useState } from 'react';

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

interface ReceivedFile {
  id: string;
  fileName: string;
  fileSize: number;
  blob: Blob;
}

export function ReceivedFilesPanel() {
  const [files, setFiles] = useState<ReceivedFile[]>([]);

  useEffect(() => {
    // Listen for files received from p2pService
    const handler = (event: Event) => {
      const custom = event as CustomEvent<ReceivedFile[]>;
      if (custom.detail) {
        setFiles((prev) => [...prev, ...custom.detail]);
      }
    };
    window.addEventListener('p2p-files-received', handler);
    return () => window.removeEventListener('p2p-files-received', handler);
  }, []);

  if (files.length === 0) return null;

  const downloadFile = (file: ReceivedFile) => {
    const url = URL.createObjectURL(file.blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 p-6">
      <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
        📥 File đã nhận ({files.length})
      </h3>
      <div className="space-y-2">
        {files.map((file) => (
          <div
            key={file.id}
            className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg"
          >
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
                {file.fileName}
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {formatBytes(file.fileSize)}
              </p>
            </div>
            <button
              onClick={() => downloadFile(file)}
              className="ml-3 px-4 py-1.5 bg-primary-500 hover:bg-primary-600 text-white text-sm font-medium rounded-lg transition-colors"
            >
              Tải xuống
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
