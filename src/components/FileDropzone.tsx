import React, { useCallback, useState, useRef } from 'react';

interface FileDropzoneProps {
  onFilesSelected: (items: (File | DataTransferItem)[]) => void;
  disabled?: boolean;
}

export const FileDropzone: React.FC<FileDropzoneProps> = ({
  onFilesSelected,
  disabled = false,
}) => {
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!disabled) {
      setIsDragging(true);
    }
  }, [disabled]);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);

      if (disabled) return;

      // Lấy tất cả items (files + directories)
      const items = Array.from(e.dataTransfer.items);
      const files: (File | DataTransferItem)[] = [];

      for (const item of items) {
        if (item.kind === 'file') {
          // DataTransferItem để giữ được thông tin thư mục
          files.push(item);
        }
      }

      if (files.length > 0) {
        onFilesSelected(files);
      }
    },
    [disabled, onFilesSelected]
  );

  const handleFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files || []).map(f => f as File);
      if (files.length > 0) {
        onFilesSelected(files);
      }
      e.target.value = '';
    },
    [onFilesSelected]
  );

  const handleFolderInput = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const items = e.target.files || [];
      const allFiles: File[] = [];

      // Get all files from directory structure
      for (let i = 0; i < items.length; i++) {
        const file = items[i];
        // file.webkitRelativePath contains the directory structure
        allFiles.push(file);
      }

      if (allFiles.length > 0) {
        console.log(`[Dropzone] Selected ${allFiles.length} files from folder`);
        onFilesSelected(allFiles);
      }
      e.target.value = '';
    },
    [onFilesSelected]
  );

  const handleClick = useCallback(() => {
    if (!disabled) {
      // Show option to select files or folder
      const choice = window.confirm('Chọn "OK" để chọn thư mục, "Cancel" để chọn file đơn lẻ');
      if (choice) {
        document.getElementById('folder-input')?.click();
      } else {
        fileInputRef.current?.click();
      }
    }
  }, [disabled]);

  return (
    <div
      className={`
        relative border-2 border-dashed rounded-2xl p-8 text-center transition-all duration-200
        ${isDragging
          ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20'
          : 'border-gray-300 dark:border-gray-600 hover:border-primary-400 hover:bg-gray-50 dark:hover:bg-gray-800/50'
        }
        ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
      `}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onClick={handleClick}
    >
      <input
        ref={fileInputRef}
        type="file"
        id="file-input"
        className="hidden"
        multiple
        onChange={handleFileInput}
        disabled={disabled}
      />

      <div className="flex flex-col items-center gap-4">
        <div className={`
          w-16 h-16 rounded-full flex items-center justify-center transition-colors
          ${isDragging ? 'bg-primary-100 dark:bg-primary-800' : 'bg-gray-100 dark:bg-gray-800'}
        `}>
          <svg
            className={`w-8 h-8 ${isDragging ? 'text-primary-500' : 'text-gray-400'}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
            />
          </svg>
        </div>

        <div>
          <p className="text-lg font-medium text-gray-700 dark:text-gray-200">
            {isDragging ? 'Thả file vào đây' : 'Kéo thả file vào đây'}
          </p>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            hoặc nhấn để chọn file
          </p>
        </div>

        {/* Supported formats */}
        <div className="flex flex-wrap justify-center gap-2 mt-2">
          <FormatBadge icon="📁" text="Thư mục" />
          <FormatBadge icon="🖼️" text="Ảnh" />
          <FormatBadge icon="📄" text="Tài liệu" />
          <FormatBadge icon="🎬" text="Video" />
          <FormatBadge icon="💾" text="Mọi file" />
        </div>

        {/* Hidden folder input */}
        <input
          ref={fileInputRef}
          type="file"
          id="file-input"
          className="hidden"
          multiple
          onChange={handleFileInput}
          disabled={disabled}
        />
        <input
          type="file"
          id="folder-input"
          className="hidden"
          // @ts-ignore - webkitdirectory is not in TS types
          webkitdirectory=""
          onChange={handleFolderInput}
          disabled={disabled}
        />

        <p className="text-xs text-gray-400 dark:text-gray-500 mt-2">
          Không giới hạn kích thước • Mã hóa E2E
        </p>
      </div>
    </div>
  );
};

const FormatBadge: React.FC<{ icon: string; text: string }> = ({ icon, text }) => (
  <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-gray-100 dark:bg-gray-700 text-xs text-gray-600 dark:text-gray-300">
    <span>{icon}</span>
    <span>{text}</span>
  </span>
);

export default FileDropzone;
