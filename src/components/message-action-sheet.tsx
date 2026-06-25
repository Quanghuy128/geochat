"use client";

import { useState } from "react";

const QUICK_EMOJI = ["👍", "❤️", "😂", "😮", "😢", "🙏"];

/**
 * Soft-validation: best-effort heuristic — reject chuỗi trông như text ASCII thường (chữ/số
 * latin only, không có ký tự ngoài BMP/emoji-range). KHÔNG chặn submit (chỉ cảnh báo inline,
 * design doc mục 3.5) — DB CHECK varchar(8)/độ dài 1-8 là lưới an toàn THẬT (edge case #7).
 */
function looksLikePlainText(value: string): boolean {
  if (value.length === 0) return false;
  return /^[\x20-\x7E]+$/.test(value);
}

/**
 * `EmojiFreeInput` — sub-state của `MessageActionSheet`, mở khi tap "+"/"Khác…" (design doc
 * mục 3.5). Presentation-only.
 */
export function EmojiFreeInput({
  value,
  onChange,
  onSubmit,
  onCancel,
  error,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
  error: string | null;
}) {
  return (
    <div className="flex flex-col gap-2 p-2">
      <input
        autoFocus
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="😀 dán hoặc gõ emoji…"
        maxLength={8}
        className="w-full rounded-full border border-zinc-300 bg-transparent px-3 py-1.5 text-sm outline-none focus:border-blue-500 dark:border-zinc-700"
      />
      {error && <p className="text-xs text-amber-600 dark:text-amber-400">⚠ {error}</p>}
      <div className="flex justify-end gap-2">
        <button
          onClick={onCancel}
          className="rounded-full border border-zinc-300 px-3 py-1 text-xs hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
        >
          Hủy
        </button>
        <button
          onClick={onSubmit}
          disabled={value.trim().length === 0}
          className="rounded-full bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          OK
        </button>
      </div>
    </div>
  );
}

/**
 * `MessageActionSheet` — emoji quick-pick + nút "Trả lời" (design doc mục 3.4). Presentation-
 * only, popover/sheet đơn giản (Open Design Q3 default: 1 component, responsive qua CSS —
 * ở đây giữ markup đơn giản nhất, không cần JS media-query, chỉ là 1 panel nhỏ anchored).
 *
 * `disabled=true` (sendBlockedReason !== null, design doc mục 3.11): KHÔNG render sheet nội
 * dung — `DmThread`/`GroupThread` chịu trách nhiệm không mở sheet này khi disabled (component
 * vẫn export `open` prop để parent control, nhưng tự vệ thêm 1 lớp ở đây).
 */
export function MessageActionSheet({
  open,
  disabled,
  quickEmoji = QUICK_EMOJI,
  onPickEmoji,
  onOpenFreeInput,
  onReply,
  onClose,
}: {
  open: boolean;
  anchorMessageId?: string;
  disabled: boolean;
  quickEmoji?: string[];
  onPickEmoji: (emoji: string) => void;
  onOpenFreeInput: () => void;
  onReply: () => void;
  onClose: () => void;
}) {
  const [freeInputOpen, setFreeInputOpen] = useState(false);
  const [freeInputValue, setFreeInputValue] = useState("");
  const [freeInputError, setFreeInputError] = useState<string | null>(null);

  if (!open || disabled) return null;

  function handleOpenFreeInput() {
    setFreeInputOpen(true);
    setFreeInputError(null);
    setFreeInputValue("");
    onOpenFreeInput();
  }

  function handleFreeInputChange(v: string) {
    setFreeInputValue(v);
    setFreeInputError(looksLikePlainText(v) ? "Vui lòng nhập emoji" : null);
  }

  function handleFreeInputSubmit() {
    const trimmed = freeInputValue.trim();
    if (!trimmed) return;
    onPickEmoji(trimmed);
    setFreeInputOpen(false);
    setFreeInputValue("");
  }

  return (
    <div className="absolute z-10 rounded-xl border border-zinc-200 bg-white shadow-lg dark:border-zinc-800 dark:bg-zinc-900">
      {freeInputOpen ? (
        <EmojiFreeInput
          value={freeInputValue}
          onChange={handleFreeInputChange}
          onSubmit={handleFreeInputSubmit}
          onCancel={() => setFreeInputOpen(false)}
          error={freeInputError}
        />
      ) : (
        <>
          <div className="flex items-center gap-1 p-2">
            {quickEmoji.map((emoji) => (
              <button
                key={emoji}
                onClick={() => onPickEmoji(emoji)}
                className="rounded-full p-1.5 text-lg hover:bg-zinc-100 dark:hover:bg-zinc-800"
              >
                {emoji}
              </button>
            ))}
            <button
              onClick={handleOpenFreeInput}
              className="rounded-full p-1.5 text-sm text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            >
              +
            </button>
          </div>
          <div className="border-t border-zinc-200 p-2 dark:border-zinc-800">
            <button
              onClick={onReply}
              className="w-full rounded-lg px-3 py-1.5 text-left text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800"
            >
              Trả lời
            </button>
          </div>
        </>
      )}
      <button
        onClick={onClose}
        className="absolute -right-2 -top-2 rounded-full bg-zinc-200 px-1.5 text-xs text-zinc-600 hover:bg-zinc-300 dark:bg-zinc-700 dark:text-zinc-300"
        aria-label="Đóng"
      >
        ×
      </button>
    </div>
  );
}
