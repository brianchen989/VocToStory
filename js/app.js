/**
 * app.js
 * 總指揮：負責初始化頁面、綁定使用者互動事件，並串接 storage、storyGenerator 與 renderer。
 *
 * 【下一階段擴充預留位置】
 * 未來可於此處匯入：
 * - import { ... } from './modules/srsScheduler.js';
 * - import { ... } from './modules/firebaseService.js';
 */

import {
  saveApiKey,
  getApiKey,
  clearApiKey,
  saveStylePrompt,
  getStylePrompt,
  clearStylePrompt,
} from './utils/storage.js';

import {
  DEFAULT_MODEL,
  DEFAULT_STYLE_PROMPT,
  MAX_NEW_WORDS,
  REVIEW_BATCH_SIZE,
  STYLE_PRESETS,
  generateStudySet,
  normalizeWords,
  chunkWords,
} from './modules/storyGenerator.js';

import {
  renderLoading,
  renderError,
  renderStatusMessage,
  renderStudySet,
  clearContainer,
} from './ui/renderer.js';

const SAMPLE_NEW_WORDS = ['ubiquitous', 'mitigate', 'ephemeral', 'corroborate', 'pragmatic'];

/**
 * 收集 DOM 元素參照。
 */
function getElements() {
  return {
    apiKeyInput: document.getElementById('api-key-input'),
    toggleKeyBtn: document.getElementById('toggle-key-btn'),
    saveKeyBtn: document.getElementById('save-key-btn'),
    clearKeyBtn: document.getElementById('clear-key-btn'),
    apiKeyStatus: document.getElementById('api-key-status'),

    studyForm: document.getElementById('study-form'),
    newWordInputs: Array.from(document.querySelectorAll('.new-word-input')),
    newWordsCount: document.getElementById('new-words-count'),
    fillSampleNewBtn: document.getElementById('fill-sample-new-btn'),
    clearNewWordsBtn: document.getElementById('clear-new-words-btn'),

    reviewWordsInput: document.getElementById('review-words-input'),
    reviewWordsInfo: document.getElementById('review-words-info'),

    presetButtonsContainer: document.getElementById('style-presets'),
    stylePromptInput: document.getElementById('style-prompt-input'),
    resetPromptBtn: document.getElementById('reset-prompt-btn'),
    promptStatus: document.getElementById('prompt-status'),

    generateBtn: document.getElementById('generate-btn'),
    modelHint: document.getElementById('model-hint'),
    feedbackArea: document.getElementById('feedback-area'),
    resultsArea: document.getElementById('results-area'),
  };
}

/**
 * 讀取目前 5 個新單字輸入框的值。
 * @param {HTMLInputElement[]} inputs
 * @returns {string[]}
 */
function collectNewWords(inputs) {
  return inputs.map((input) => input.value.trim()).filter(Boolean);
}

/**
 * 更新新單字與複習單字的即時字數與分批提示。
 * @param {ReturnType<typeof getElements>} els
 */
function updateWordCounters(els) {
  const cleanedNew = normalizeWords(collectNewWords(els.newWordInputs));
  const newWordLowerSet = new Set(cleanedNew.map((w) => w.toLowerCase()));

  els.newWordsCount.textContent = `有效新單字：${cleanedNew.length} / ${MAX_NEW_WORDS}（可輸入 0～${MAX_NEW_WORDS} 個）`;

  const cleanedReview = normalizeWords(els.reviewWordsInput.value).filter(
    (w) => !newWordLowerSet.has(w.toLowerCase())
  );
  const batches = chunkWords(cleanedReview, REVIEW_BATCH_SIZE);

  if (cleanedReview.length === 0) {
    els.reviewWordsInfo.textContent = '選填：目前無複習單字（若與新單字重複會自動略過）';
  } else {
    els.reviewWordsInfo.textContent = `有效複習單字：${cleanedReview.length} 個，將自動分成 ${batches.length} 批生成（每批最多 ${REVIEW_BATCH_SIZE} 字）`;
  }
}

/**
 * 渲染風格快捷預設按鈕，並標示目前選中的範本。
 * @param {ReturnType<typeof getElements>} els
 */
function initStylePresets(els) {
  const buttonsHtml = STYLE_PRESETS.map(
    (preset) => `
      <button
        type="button"
        class="preset-chip"
        data-preset-id="${preset.id}"
      >
        ${preset.label}
      </button>
    `
  ).join('');

  els.presetButtonsContainer.innerHTML = buttonsHtml;

  const updateActiveChip = (currentPrompt) => {
    const trimmed = currentPrompt.trim();
    const chips = els.presetButtonsContainer.querySelectorAll('.preset-chip');
    chips.forEach((chip) => {
      const preset = STYLE_PRESETS.find((item) => item.id === chip.dataset.presetId);
      chip.classList.toggle('preset-chip--active', Boolean(preset && preset.prompt.trim() === trimmed));
    });
  };

  // 初始化載入已儲存的風格 Prompt（若無則帶入預設值）
  const savedPrompt = getStylePrompt();
  els.stylePromptInput.value = savedPrompt || DEFAULT_STYLE_PROMPT;
  updateActiveChip(els.stylePromptInput.value);

  // 點擊快捷風格範本
  els.presetButtonsContainer.addEventListener('click', (event) => {
    const target = event.target.closest('.preset-chip');
    if (!target) {
      return;
    }

    const preset = STYLE_PRESETS.find((item) => item.id === target.dataset.presetId);
    if (!preset) {
      return;
    }

    els.stylePromptInput.value = preset.prompt;
    saveStylePrompt(preset.prompt);
    updateActiveChip(preset.prompt);
    renderStatusMessage(els.promptStatus, `已套用「${preset.label}」風格並儲存。`, 'success');
  });

  // 使用者手動編輯風格 Prompt 時自動儲存
  els.stylePromptInput.addEventListener('input', () => {
    const current = els.stylePromptInput.value;
    saveStylePrompt(current);
    updateActiveChip(current);
    renderStatusMessage(els.promptStatus, '已自動儲存自訂風格 Prompt。', 'info');
  });

  // 恢復預設 Prompt
  els.resetPromptBtn.addEventListener('click', () => {
    clearStylePrompt();
    els.stylePromptInput.value = DEFAULT_STYLE_PROMPT;
    updateActiveChip(DEFAULT_STYLE_PROMPT);
    renderStatusMessage(els.promptStatus, '已恢復為預設風格 Prompt。', 'success');
  });
}

/**
 * 初始化 API Key 管理區域事件。
 * @param {ReturnType<typeof getElements>} els
 */
function initApiKeyControls(els) {
  const savedKey = getApiKey();
  if (savedKey) {
    els.apiKeyInput.value = savedKey;
    renderStatusMessage(els.apiKeyStatus, '已載入儲存在本機瀏覽器的 API Key。', 'success');
  } else {
    renderStatusMessage(
      els.apiKeyStatus,
      'API Key 僅儲存在您的瀏覽器 localStorage，不會傳送至第三方伺服器。',
      'info'
    );
  }

  els.toggleKeyBtn.addEventListener('click', () => {
    const isPassword = els.apiKeyInput.type === 'password';
    els.apiKeyInput.type = isPassword ? 'text' : 'password';
    els.toggleKeyBtn.textContent = isPassword ? '隱藏' : '顯示';
  });

  els.saveKeyBtn.addEventListener('click', () => {
    const key = els.apiKeyInput.value.trim();
    if (!key) {
      renderStatusMessage(els.apiKeyStatus, '請先輸入 Gemini API Key 再儲存。', 'error');
      return;
    }

    const saved = saveApiKey(key);
    if (saved) {
      renderStatusMessage(els.apiKeyStatus, 'API Key 已儲存至本機瀏覽器。', 'success');
    } else {
      renderStatusMessage(
        els.apiKeyStatus,
        '瀏覽器目前封鎖 localStorage，但本次頁面仍可直接使用輸入的金鑰。',
        'error'
      );
    }
  });

  els.clearKeyBtn.addEventListener('click', () => {
    clearApiKey();
    els.apiKeyInput.value = '';
    renderStatusMessage(els.apiKeyStatus, '已清除本機儲存的 API Key。', 'info');
  });
}

/**
 * 應用程式進入點。
 */
function initApp() {
  const els = getElements();

  if (els.modelHint) {
    els.modelHint.textContent = `目前模型：${DEFAULT_MODEL}`;
  }

  initApiKeyControls(els);
  initStylePresets(els);

  // 單字輸入即時統計
  els.newWordInputs.forEach((input) => {
    input.addEventListener('input', () => updateWordCounters(els));
  });
  els.reviewWordsInput.addEventListener('input', () => updateWordCounters(els));

  // 新單字快捷按鈕：填入範例 / 清空
  els.fillSampleNewBtn.addEventListener('click', () => {
    els.newWordInputs.forEach((input, index) => {
      input.value = SAMPLE_NEW_WORDS[index] || '';
    });
    updateWordCounters(els);
  });

  els.clearNewWordsBtn.addEventListener('click', () => {
    els.newWordInputs.forEach((input) => {
      input.value = '';
    });
    updateWordCounters(els);
  });

  updateWordCounters(els);

  // 送出表單：呼叫核心模塊並交由 renderer 渲染
  els.studyForm.addEventListener('submit', async (event) => {
    event.preventDefault();

    const apiKey = els.apiKeyInput.value.trim() || getApiKey();
    if (apiKey && apiKey !== getApiKey()) {
      saveApiKey(apiKey);
      renderStatusMessage(els.apiKeyStatus, '已自動同步儲存 API Key。', 'success');
    }

    const newWords = collectNewWords(els.newWordInputs);
    const reviewWords = els.reviewWordsInput.value;
    const stylePrompt = els.stylePromptInput.value.trim();

    els.generateBtn.disabled = true;
    els.generateBtn.textContent = '生成中…';
    clearContainer(els.resultsArea);
    renderLoading(els.feedbackArea, '準備呼叫 Gemini API…');

    try {
      const studySet = await generateStudySet(newWords, reviewWords, apiKey, {
        stylePrompt,
        onProgress: (progressMessage) => {
          renderLoading(els.feedbackArea, progressMessage);
        },
      });

      clearContainer(els.feedbackArea);
      renderStudySet(els.resultsArea, studySet);
    } catch (error) {
      const errorMessage =
        error && typeof error.message === 'string' && error.message.trim()
          ? error.message
          : '生成過程發生未知錯誤，請稍後再試。';

      renderError(els.feedbackArea, errorMessage);
    } finally {
      els.generateBtn.disabled = false;
      els.generateBtn.textContent = '生成學習內容';
    }
  });
}

document.addEventListener('DOMContentLoaded', initApp);
