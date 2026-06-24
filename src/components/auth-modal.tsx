"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useAuth } from "@/lib/use-auth";
import { validateUsername } from "@/lib/username-utils";

type Tab = "signin" | "signup";

interface AuthModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Modal đăng nhập / đăng ký bằng username + password.
 * Không dùng shadcn Dialog vì chưa có components/ui/dialog.tsx.
 * Dùng native <dialog> element cho a11y (focus trap, ESC close).
 */
export function AuthModal({ open, onOpenChange }: AuthModalProps) {
  const { signIn, signUp } = useAuth();
  const [tab, setTab] = useState<Tab>("signin");
  const dialogRef = useRef<HTMLDialogElement>(null);

  // Sync open state với native <dialog>
  // useLayoutEffect để tránh flash frame giữa render và DOM mutation.
  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open) {
      if (!dialog.open) dialog.showModal();
    } else {
      if (dialog.open) dialog.close();
    }
  }, [open]);

  // Xử lý ESC (native dialog tự phát 'cancel' khi ESC)
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const handleCancel = (e: Event) => {
      e.preventDefault();
      onOpenChange(false);
    };
    dialog.addEventListener("cancel", handleCancel);
    return () => dialog.removeEventListener("cancel", handleCancel);
  }, [onOpenChange]);

  // Click backdrop (click trên dialog chính ngoài vùng content) → đóng
  function handleDialogClick(e: React.MouseEvent<HTMLDialogElement>) {
    if (e.target === dialogRef.current) {
      onOpenChange(false);
    }
  }

  // Reset form khi đổi tab
  function handleTabChange(newTab: Tab) {
    setTab(newTab);
  }

  if (!open) return null;

  return (
    <dialog
      ref={dialogRef}
      onClick={handleDialogClick}
      className="m-auto rounded-2xl border border-zinc-200 bg-white p-0 shadow-xl backdrop:bg-black/50 dark:border-zinc-700 dark:bg-zinc-900"
      style={{ maxWidth: "420px", width: "calc(100vw - 2rem)" }}
    >
      <div className="p-6">
        {/* Header */}
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-lg font-bold text-zinc-900 dark:text-zinc-100">
            {tab === "signin" ? "Đăng nhập" : "Đăng ký"}
          </h2>
          <button
            onClick={() => onOpenChange(false)}
            className="rounded-full p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800"
            aria-label="Đóng"
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
              <path d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" />
            </svg>
          </button>
        </div>

        {/* Tabs */}
        <div className="mb-5 flex rounded-xl bg-zinc-100 p-1 dark:bg-zinc-800">
          <button
            onClick={() => handleTabChange("signin")}
            className={`flex-1 rounded-lg py-2 text-sm font-medium transition-colors ${
              tab === "signin"
                ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-zinc-100"
                : "text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
            }`}
          >
            Đăng nhập
          </button>
          <button
            onClick={() => handleTabChange("signup")}
            className={`flex-1 rounded-lg py-2 text-sm font-medium transition-colors ${
              tab === "signup"
                ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-zinc-100"
                : "text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
            }`}
          >
            Đăng ký
          </button>
        </div>

        {tab === "signin" ? (
          <SignInForm onSuccess={() => onOpenChange(false)} signIn={signIn} />
        ) : (
          <SignUpForm onSuccess={() => onOpenChange(false)} signUp={signUp} />
        )}
      </div>
    </dialog>
  );
}

// ─── Sign In Form ──────────────────────────────────────────────────────────────

interface SignInFormProps {
  onSuccess: () => void;
  signIn: (username: string, password: string) => Promise<{ error: string | null }>;
}

function SignInForm({ onSuccess, signIn }: SignInFormProps) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (loading) return;
    setError(null);
    setLoading(true);

    const { error: err } = await signIn(username.trim(), password);
    setLoading(false);

    if (err) {
      setError(err);
      return;
    }
    onSuccess();
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <label htmlFor="signin-username" className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
          Username
        </label>
        <input
          id="signin-username"
          type="text"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="username"
          autoComplete="username"
          disabled={loading}
          className="rounded-xl border border-zinc-300 bg-transparent px-4 py-2 text-sm outline-none focus:border-blue-500 disabled:opacity-50 dark:border-zinc-700 dark:focus:border-blue-400"
        />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="signin-password" className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
          Password
        </label>
        <input
          id="signin-password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="••••••••"
          autoComplete="current-password"
          disabled={loading}
          className="rounded-xl border border-zinc-300 bg-transparent px-4 py-2 text-sm outline-none focus:border-blue-500 disabled:opacity-50 dark:border-zinc-700 dark:focus:border-blue-400"
        />
      </div>
      {error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600 dark:bg-red-900/20 dark:text-red-400">
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={loading || !username.trim() || !password}
        className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
      >
        {loading ? "Đang đăng nhập…" : "Đăng nhập"}
      </button>
    </form>
  );
}

// ─── Sign Up Form ──────────────────────────────────────────────────────────────

interface SignUpFormProps {
  onSuccess: () => void;
  signUp: (username: string, password: string) => Promise<{ error: string | null }>;
}

function SignUpForm({ onSuccess, signUp }: SignUpFormProps) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [usernameError, setUsernameError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Validate username real-time khi user nhập
  function handleUsernameChange(value: string) {
    setUsername(value);
    if (value.length > 0) {
      setUsernameError(validateUsername(value));
    } else {
      setUsernameError(null);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (loading) return;

    // Final validation trước submit
    const usernameErr = validateUsername(username.trim());
    if (usernameErr) {
      setUsernameError(usernameErr);
      return;
    }

    if (password.length < 6) {
      setSubmitError("Password phải có ít nhất 6 ký tự.");
      return;
    }

    if (password !== confirmPassword) {
      setSubmitError("Xác nhận password không khớp.");
      return;
    }

    setSubmitError(null);
    setLoading(true);

    const { error: err } = await signUp(username.trim(), password);
    setLoading(false);

    if (err) {
      setSubmitError(err);
      return;
    }
    onSuccess();
  }

  const canSubmit =
    !loading &&
    username.trim().length > 0 &&
    !usernameError &&
    password.length >= 6 &&
    confirmPassword.length > 0;

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <label htmlFor="signup-username" className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
          Username
        </label>
        <input
          id="signup-username"
          type="text"
          value={username}
          onChange={(e) => handleUsernameChange(e.target.value)}
          placeholder="username (3-20 ký tự, bắt đầu bằng chữ cái)"
          autoComplete="username"
          disabled={loading}
          className={`rounded-xl border bg-transparent px-4 py-2 text-sm outline-none disabled:opacity-50 ${
            usernameError
              ? "border-red-400 focus:border-red-500 dark:border-red-500"
              : "border-zinc-300 focus:border-blue-500 dark:border-zinc-700 dark:focus:border-blue-400"
          }`}
        />
        {usernameError && (
          <p className="text-xs text-red-500">{usernameError}</p>
        )}
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="signup-password" className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
          Password
        </label>
        <input
          id="signup-password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="••••••••  (ít nhất 6 ký tự)"
          autoComplete="new-password"
          disabled={loading}
          className="rounded-xl border border-zinc-300 bg-transparent px-4 py-2 text-sm outline-none focus:border-blue-500 disabled:opacity-50 dark:border-zinc-700 dark:focus:border-blue-400"
        />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="signup-confirm" className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
          Xác nhận password
        </label>
        <input
          id="signup-confirm"
          type="password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          placeholder="••••••••"
          autoComplete="new-password"
          disabled={loading}
          className="rounded-xl border border-zinc-300 bg-transparent px-4 py-2 text-sm outline-none focus:border-blue-500 disabled:opacity-50 dark:border-zinc-700 dark:focus:border-blue-400"
        />
      </div>
      {submitError && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600 dark:bg-red-900/20 dark:text-red-400">
          {submitError}
        </p>
      )}
      <button
        type="submit"
        disabled={!canSubmit}
        className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
      >
        {loading ? "Đang đăng ký…" : "Đăng ký"}
      </button>
    </form>
  );
}
