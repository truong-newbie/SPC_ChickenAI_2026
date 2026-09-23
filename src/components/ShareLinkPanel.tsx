interface ShareLinkPanelProps {
  link: string;
  onCopy: () => void;
  copied: boolean;
}

export function ShareLinkPanel({ link, onCopy, copied }: ShareLinkPanelProps) {
  return (
    <div className="bg-gradient-to-r from-primary-500/10 to-purple-500/10 rounded-xl p-4 border border-primary-500/20">
      <div className="flex items-center gap-2 mb-2">
        <svg className="w-5 h-5 text-primary-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
        </svg>
        <span className="font-medium text-gray-800 dark:text-gray-200">Chia sẻ link</span>
      </div>

      <div className="flex gap-2">
        <input
          type="text"
          value={link}
          readOnly
          className="flex-1 px-3 py-2 bg-white/80 dark:bg-gray-800/80 rounded-lg text-sm font-mono text-gray-700 dark:text-gray-300 border border-gray-200 dark:border-gray-700"
        />
        <button
          onClick={onCopy}
          className={`px-4 py-2 rounded-lg font-medium transition-colors ${
            copied
              ? 'bg-green-500 hover:bg-green-600 text-white'
              : 'bg-primary-500 hover:bg-primary-600 text-white'
          }`}
        >
          {copied ? '✓' : 'Copy'}
        </button>
      </div>

      <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
        Người nhận mở link này để nhận file
      </p>
    </div>
  );
}
