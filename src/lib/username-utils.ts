/**
 * Pure utility functions cho username validation và email generation.
 * Không import Supabase — dễ unit test.
 */

/**
 * Username hợp lệ: 3-20 ký tự, bắt đầu bằng chữ cái, chỉ [a-zA-Z0-9_-].
 * Khớp với constraint DB: `^[a-zA-Z][a-zA-Z0-9_-]*$` + length check.
 */
export const USERNAME_REGEX = /^[a-zA-Z][a-zA-Z0-9_-]{2,19}$/;

/**
 * Validate username theo quy tắc.
 * @returns Error message (string) nếu invalid, null nếu hợp lệ.
 */
export function validateUsername(username: string): string | null {
  if (!username || username.length === 0) {
    return "Username không được để trống.";
  }
  if (username.length < 3) {
    return "Username phải có ít nhất 3 ký tự.";
  }
  if (username.length > 20) {
    return "Username không được quá 20 ký tự.";
  }
  if (!/^[a-zA-Z]/.test(username)) {
    return "Username phải bắt đầu bằng chữ cái (a-z, A-Z).";
  }
  if (!USERNAME_REGEX.test(username)) {
    return "Username chỉ được chứa chữ cái, số, dấu gạch dưới (_) và gạch ngang (-).";
  }
  return null;
}

/**
 * Tạo email fake từ username.
 * Luôn lowercase username trước khi ghép.
 */
export function buildFakeEmail(username: string): string {
  return `${username.toLowerCase()}@geochat.app`;
}
