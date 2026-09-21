import React, { useState } from 'react';

interface JoinRoomProps {
  onJoin: (code: string) => void;
  disabled?: boolean;
}

export const JoinRoom: React.FC<JoinRoomProps> = ({ onJoin, disabled = false }) => {
  const [code, setCode] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const upperCode = code.toUpperCase();

    if (upperCode.length !== 6 || !/^[A-Z0-9]{6}$/.test(upperCode)) {
      setError('Mã phòng phải gồm 6 ký tự (A-Z, 0-9)');
      return;
    }

    setError('');
    onJoin(upperCode);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label htmlFor="room-code" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
          Nhập mã phòng
        </label>
        <div className="flex gap-2">
          {Array.from({ length: 6 }).map((_, index) => (
            <input
              key={index}
              type="text"
              value={code[index] || ''}
              onChange={(e) => {
                const newCode = code.split('');
                newCode[index] = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
                const updated = newCode.join('').slice(0, 6);
                setCode(updated);
                if (error) setError('');
              }}
              onKeyDown={(e) => {
                if (e.key === 'Backspace' && !code[index] && index > 0) {
                  const inputs = document.querySelectorAll<HTMLInputElement>('input[data-room-index]');
                  inputs[index - 1]?.focus();
                }
              }}
              data-room-index={index}
              maxLength={1}
              disabled={disabled}
              className="
                w-12 h-14 text-center text-xl font-bold
                bg-white dark:bg-gray-800
                border border-gray-300 dark:border-gray-600
                rounded-xl shadow-sm
                focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent
                transition-all duration-200
                disabled:opacity-50 disabled:cursor-not-allowed
              "
              placeholder={index === 0 ? 'A' : ''}
            />
          ))}
        </div>
        {error && (
          <p className="mt-2 text-sm text-red-500 dark:text-red-400">{error}</p>
        )}
      </div>

      <button
        type="submit"
        disabled={code.length !== 6 || disabled}
        className="
          w-full py-3 px-4 rounded-xl font-semibold text-white
          bg-primary-500 hover:bg-primary-600
          focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2
          disabled:opacity-50 disabled:cursor-not-allowed
          transition-all duration-200
          active:scale-[0.98]
        "
      >
        {disabled ? 'Đang kết nối...' : 'Tham gia phòng'}
      </button>
    </form>
  );
};

export default JoinRoom;
