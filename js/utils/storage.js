/**
 * storage.js
 * 工具模塊：負責透過 localStorage 存取使用者的 Gemini API Key 與自訂文章風格 Prompt。
 */

export const STORAGE_KEYS = Object.freeze({
  GEMINI_API_KEY: 'toefl_story_gemini_api_key',
  STYLE_PROMPT: 'toefl_story_style_prompt',
});

/**
 * 儲存 Gemini API Key 至 localStorage。
 * 若傳入空白字串，將改為清除既有金鑰。
 * @param {string} apiKey
 * @returns {boolean} 是否成功寫入
 */
export function saveApiKey(apiKey) {
  const trimmed = typeof apiKey === 'string' ? apiKey.trim() : '';
  if (!trimmed) {
    return clearApiKey();
  }

  try {
    globalThis.localStorage.setItem(STORAGE_KEYS.GEMINI_API_KEY, trimmed);
    return true;
  } catch {
    return false;
  }
}

/**
 * 從 localStorage 讀取 Gemini API Key。
 * @returns {string} 已儲存的金鑰，若不存在或無法存取則回傳空字串
 */
export function getApiKey() {
  try {
    return globalThis.localStorage.getItem(STORAGE_KEYS.GEMINI_API_KEY) || '';
  } catch {
    return '';
  }
}

/**
 * 清除儲存於 localStorage 的 Gemini API Key。
 * @returns {boolean} 是否成功清除
 */
export function clearApiKey() {
  try {
    globalThis.localStorage.removeItem(STORAGE_KEYS.GEMINI_API_KEY);
    return true;
  } catch {
    return false;
  }
}

/**
 * 儲存使用者的自訂文章風格 Prompt。
 * @param {string} promptText
 * @returns {boolean}
 */
export function saveStylePrompt(promptText) {
  const trimmed = typeof promptText === 'string' ? promptText.trim() : '';
  if (!trimmed) {
    return clearStylePrompt();
  }

  try {
    globalThis.localStorage.setItem(STORAGE_KEYS.STYLE_PROMPT, trimmed);
    return true;
  } catch {
    return false;
  }
}

/**
 * 讀取使用者的自訂文章風格 Prompt。
 * @returns {string}
 */
export function getStylePrompt() {
  try {
    return globalThis.localStorage.getItem(STORAGE_KEYS.STYLE_PROMPT) || '';
  } catch {
    return '';
  }
}

/**
 * 清除使用者的自訂文章風格 Prompt。
 * @returns {boolean}
 */
export function clearStylePrompt() {
  try {
    globalThis.localStorage.removeItem(STORAGE_KEYS.STYLE_PROMPT);
    return true;
  } catch {
    return false;
  }
}
