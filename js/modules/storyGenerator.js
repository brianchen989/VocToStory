/**
 * storyGenerator.js
 * 核心模塊：負責呼叫 Gemini REST API、單字清理與分批處理、漏字檢查與錯誤處理。
 * 嚴格遵守關注點分離：此模塊絕不操作 DOM。
 */

export const DEFAULT_MODEL = 'gemini-2.5-flash';
export const MAX_NEW_WORDS = 5;
export const REVIEW_BATCH_SIZE = 6;

const GEMINI_API_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';
const REQUEST_TIMEOUT_MS = 45000;

export const DEFAULT_STYLE_PROMPT =
  '請撰寫一篇結構清晰、有故事畫面感且貼近托福閱讀主題（如自然科學、歷史人文、心理或科技趨勢）的英文短文，語氣自然流暢，讓讀者能透過上下文自然推敲目標單字的語意。';

export const STYLE_PRESETS = Object.freeze([
  {
    id: 'toefl-academic',
    label: '托福科普短文（預設）',
    prompt: DEFAULT_STYLE_PROMPT,
  },
  {
    id: 'mystery',
    label: '懸疑推理故事',
    prompt:
      '請以懸疑推理小說的口吻撰寫一篇引人入勝的短篇故事，包含清晰的線索推進與反轉結局，讓目標單字自然出現在角色對話或案情推論中。',
  },
  {
    id: 'scifi',
    label: '科幻冒險故事',
    prompt:
      '請以輕科幻冒險故事的風格撰寫一篇生動短文，設定在近未來城市或太空探索任務，節奏緊湊、畫面鮮明，將目標單字自然融入情節發展中。',
  },
  {
    id: 'campus-life',
    label: '校園／日常故事',
    prompt:
      '請以輕鬆自然的大學校園生活或日常生活故事為題材撰寫短文，貼近真實人物互動與情境，幫助讀者透過熟悉的生活場景記住目標單字。',
  },
]);

/**
 * 核心模塊專用錯誤類別，攜帶機器可讀的錯誤代碼與繁體中文使用者訊息。
 */
export class StoryGeneratorError extends Error {
  /**
   * @param {string} message 繁體中文錯誤訊息
   * @param {string} code 錯誤代碼
   * @param {number|null} [status=null] HTTP 狀態碼
   */
  constructor(message, code, status = null) {
    super(message);
    this.name = 'StoryGeneratorError';
    this.code = code;
    this.status = status;
  }
}

/**
 * 清理並去重單字列表（去除前後空白、空字串，忽略大小寫去重並保留首次出現的拼法）。
 * @param {string[]|string} words
 * @returns {string[]}
 */
export function normalizeWords(words) {
  let rawList = [];

  if (Array.isArray(words)) {
    rawList = words;
  } else if (typeof words === 'string') {
    rawList = words.split(/[,，;\n]+/);
  }

  const seen = new Set();
  const result = [];

  for (const item of rawList) {
    if (typeof item !== 'string') {
      continue;
    }

    const cleaned = item.trim().replace(/\s+/g, ' ');
    if (!cleaned) {
      continue;
    }

    const lower = cleaned.toLowerCase();
    if (!seen.has(lower)) {
      seen.add(lower);
      result.push(cleaned);
    }
  }

  return result;
}

/**
 * 將單字陣列依指定大小分批。
 * @param {string[]} words
 * @param {number} [chunkSize=REVIEW_BATCH_SIZE]
 * @returns {string[][]}
 */
export function chunkWords(words, chunkSize = REVIEW_BATCH_SIZE) {
  if (!Array.isArray(words) || words.length === 0) {
    return [];
  }

  const size = Math.max(1, Number(chunkSize) || REVIEW_BATCH_SIZE);
  const batches = [];

  for (let i = 0; i < words.length; i += size) {
    batches.push(words.slice(i, i + size));
  }

  return batches;
}

/**
 * 移除意外出現的 Markdown 粗體或斜體符號，維持純淨閱讀文字。
 * @param {string} text
 * @returns {string}
 */
function stripMarkdownEmphasis(text) {
  if (typeof text !== 'string') {
    return '';
  }
  return text.replace(/\*\*(.+?)\*\*/g, '$1').replace(/__(.+?)__/g, '$1').trim();
}

/**
 * 跳脫正規表達式特殊字元。
 * @param {string} value
 * @returns {string}
 */
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 產生英文單字常見詞形變化候選（供漏字檢查使用，避免正常時態或複數變化被誤判為漏字）。
 * @param {string} word
 * @returns {string[]}
 */
function buildWordInflections(word) {
  const lower = word.toLowerCase();
  const forms = new Set([lower]);

  // 僅針對純英文字母單字展開常見詞尾變化
  if (/^[a-z]+$/.test(lower)) {
    forms.add(`${lower}s`);
    forms.add(`${lower}es`);
    forms.add(`${lower}d`);
    forms.add(`${lower}ed`);
    forms.add(`${lower}ing`);

    if (lower.length > 2 && lower.endsWith('e')) {
      const stem = lower.slice(0, -1);
      forms.add(`${stem}ing`);
      forms.add(`${stem}ed`);
      forms.add(`${stem}er`);
      forms.add(`${stem}est`);
    }

    if (lower.length > 2 && lower.endsWith('y')) {
      const stem = lower.slice(0, -1);
      forms.add(`${stem}ies`);
      forms.add(`${stem}ied`);
      forms.add(`${stem}ier`);
      forms.add(`${stem}iest`);
    }

    if (lower.length > 2 && /[bcdfghjklmnpqrstvwxyz]$/.test(lower)) {
      const lastChar = lower[lower.length - 1];
      forms.add(`${lower}${lastChar}ed`);
      forms.add(`${lower}${lastChar}ing`);
    }
  }

  return Array.from(forms);
}

/**
 * 建立比對單字或片語的正規表達式（忽略大小寫）。
 * @param {string} targetWord
 * @returns {RegExp}
 */
function buildTargetWordRegex(targetWord) {
  const trimmed = targetWord.trim();
  const parts = trimmed.split(/\s+/);

  if (parts.length === 1) {
    const variants = buildWordInflections(parts[0]).map(escapeRegExp);
    return new RegExp(`(?<![A-Za-z])(?:${variants.join('|')})(?![A-Za-z])`, 'i');
  }

  // 片語（例如 carry out）：允許第一個字出現常見動詞詞形變化，其餘詞組以彈性空白連接
  const firstVariants = buildWordInflections(parts[0]).map(escapeRegExp);
  const restPattern = parts.slice(1).map(escapeRegExp).join('\\s+');
  return new RegExp(
    `(?<![A-Za-z])(?:${firstVariants.join('|')})\\s+${restPattern}(?![A-Za-z])`,
    'i'
  );
}

/**
 * 檢查文章中是否漏掉任何目標單字（忽略大小寫，支援基本詞形變化）。
 * @param {string} content 文章內文
 * @param {string[]} targetWords 目標單字陣列
 * @returns {string[]} 遺漏的單字陣列
 */
export function findMissingWords(content, targetWords) {
  if (!Array.isArray(targetWords) || targetWords.length === 0) {
    return [];
  }

  const normalizedContent = stripMarkdownEmphasis(content || '');
  const missing = [];

  for (const word of targetWords) {
    if (!word || typeof word !== 'string') {
      continue;
    }

    const regex = buildTargetWordRegex(word);
    if (!regex.test(normalizedContent)) {
      missing.push(word);
    }
  }

  return missing;
}

/**
 * 建立新單字（單字卡 + 文章）的 Gemini JSON Schema。
 * @returns {object}
 */
function buildNewWordsResponseSchema() {
  return {
    type: 'OBJECT',
    properties: {
      newWordCards: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: {
            word: { type: 'STRING' },
            chinese: { type: 'STRING' },
            mnemonic: { type: 'STRING' },
            example: { type: 'STRING' },
          },
          required: ['word', 'chinese', 'mnemonic', 'example'],
        },
      },
      newWordsArticle: {
        type: 'OBJECT',
        properties: {
          title: { type: 'STRING' },
          content: { type: 'STRING' },
        },
        required: ['title', 'content'],
      },
    },
    required: ['newWordCards', 'newWordsArticle'],
  };
}

/**
 * 建立複習文章的 Gemini JSON Schema。
 * @returns {object}
 */
function buildReviewArticleResponseSchema() {
  return {
    type: 'OBJECT',
    properties: {
      title: { type: 'STRING' },
      content: { type: 'STRING' },
    },
    required: ['title', 'content'],
  };
}

/**
 * 組合新單字卡與文章的系統與使用者 Prompt。
 * @param {string[]} newWords
 * @param {string} stylePrompt
 * @returns {string}
 */
function buildNewWordsPrompt(newWords, stylePrompt) {
  const wordListText = newWords.map((word, index) => `${index + 1}. ${word}`).join('\n');

  return [
    '你是一位專業的台灣托福（TOEFL iBT）英文教學專家與英語故事作家。請嚴格依照以下規則產生 JSON 學習資料：',
    '',
    '【本次目標新單字】',
    wordListText,
    '',
    '【任務一：newWordCards（單字學習卡）】',
    `- 必須為以上每一個單字各產出 1 筆資料（共 ${newWords.length} 筆），順序與拼法請與目標單字完全一致。`,
    '- word：目標英文單字原文。',
    '- chinese：精準且易懂的繁體中文釋義（含詞性，例如：「adj. 無所不在的；普遍存在的」）。',
    '- mnemonic：以繁體中文撰寫實用的字根／字首拆解或畫面聯想記憶法，簡潔好記。',
    '- example：撰寫 1 句自然且具托福語境的英文例句（除了目標單字本身，其餘詞彙盡量維持台灣高中 7000 單程度，句意清楚）。',
    '',
    '【任務二：newWordsArticle（短文閱讀）】',
    '- title：簡潔吸引人的英文標題。',
    '- content：撰寫一篇約 150–220 字的英文短文（可適度分 2–3 段，段落間以換行分隔）。',
    '- 【核心詞彙難度硬性規則】除了上述目標單字以外，文章其餘所有用字必須控制在「台灣高中 7000 單字程度（約 CEFR B1–B2）」，避免使用其他生僻高階學術字或 GRE 難字，讓學習者能專注吸收本次目標單字。',
    '- 【涵蓋率硬性規則】文章必須自然融入所有目標單字，不可遺漏任何一個（建議優先使用原形，或在符合文法下自然使用）。',
    '- 【格式硬性規則】文章內請以純淨自然散文呈現，絕對不要對目標單字使用粗體（**）、斜體（*）、底線、引號或任何特殊符號標記出來。',
    '',
    '【文章風格與題材指示】',
    stylePrompt,
  ].join('\n');
}

/**
 * 組合複習單字批次文章的 Prompt。
 * @param {string[]} batchWords
 * @param {string} stylePrompt
 * @param {number} batchIndex
 * @param {number} totalBatches
 * @returns {string}
 */
function buildReviewArticlePrompt(batchWords, stylePrompt, batchIndex, totalBatches) {
  const wordListText = batchWords.map((word, index) => `${index + 1}. ${word}`).join('\n');

  return [
    `你是一位專業的台灣托福（TOEFL iBT）英文教學專家與英語故事作家。請為第 ${batchIndex}/${totalBatches} 批複習單字撰寫一篇複習短文，並嚴格回傳 JSON：`,
    '',
    '【本批目標複習單字】',
    wordListText,
    '',
    '【短文撰寫硬性規則】',
    '- title：簡潔吸引人的英文標題。',
    '- content：撰寫一篇約 150–220 字的英文短文（可適度分 2–3 段，段落間以換行分隔）。',
    '- 【核心詞彙難度硬性規則】除了本批目標複習單字以外，文章其餘所有用字必須控制在「台灣高中 7000 單字程度（約 CEFR B1–B2）」，避免出現目標單字以外的生僻難字。',
    '- 【涵蓋率硬性規則】文章必須自然融入本批全部目標單字，不可遺漏任何一個。',
    '- 【格式硬性規則】文章內請以純淨自然散文呈現，絕對不要對目標單字使用粗體（**）、斜體（*）、底線、引號或任何特殊符號標記出來。',
    '',
    '【文章風格與題材指示】',
    stylePrompt,
  ].join('\n');
}

/**
 * 將 Gemini HTTP 錯誤狀態映射為清楚的繁體中文訊息。
 * @param {number} status
 * @param {string} apiErrorMessage
 * @returns {StoryGeneratorError}
 */
function createHttpError(status, apiErrorMessage = '') {
  const lowerDetail = apiErrorMessage.toLowerCase();

  if (status === 400) {
    if (
      lowerDetail.includes('api key') ||
      lowerDetail.includes('api_key_invalid') ||
      lowerDetail.includes('invalid')
    ) {
      return new StoryGeneratorError(
        'Gemini API Key 無效或格式錯誤（400），請檢查您的金鑰是否正確。',
        'INVALID_API_KEY',
        status
      );
    }
    return new StoryGeneratorError(
      '請求參數無效（400），請檢查 API Key 或輸入內容後再試。',
      'BAD_REQUEST',
      status
    );
  }

  if (status === 401 || status === 403) {
    return new StoryGeneratorError(
      `Gemini API Key 無效或權限不足（${status}），請確認金鑰正確且已啟用 Gemini API。`,
      'UNAUTHORIZED',
      status
    );
  }

  if (status === 429) {
    return new StoryGeneratorError(
      '已超過 Gemini API 免費額度或呼叫頻率上限（429），請稍候片刻再試。',
      'RATE_LIMIT',
      status
    );
  }

  if (status >= 500) {
    return new StoryGeneratorError(
      `Gemini 伺服器目前暫時忙碌或異常（${status}），請稍後再試。`,
      'SERVER_ERROR',
      status
    );
  }

  return new StoryGeneratorError(
    `Gemini API 請求失敗（HTTP ${status}）${apiErrorMessage ? `：${apiErrorMessage}` : '。'}`,
    'HTTP_ERROR',
    status
  );
}

/**
 * 解析 Gemini 回傳的文字為 JSON 物件。
 * @param {string} rawText
 * @returns {any}
 */
function parseGeminiJson(rawText) {
  if (typeof rawText !== 'string' || !rawText.trim()) {
    throw new StoryGeneratorError(
      '模型未回傳有效內容，請稍後再試。',
      'EMPTY_RESPONSE'
    );
  }

  const trimmed = rawText.trim();
  const cleaned = trimmed
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    throw new StoryGeneratorError(
      '模型回傳的 JSON 格式異常，請稍後重試。',
      'INVALID_JSON'
    );
  }
}

/**
 * 透過瀏覽器原生 fetch() 呼叫 Gemini REST API，強制回傳結構化 JSON。
 * @param {object} params
 * @param {string} params.apiKey
 * @param {string} params.model
 * @param {string} params.prompt
 * @param {object} params.responseSchema
 * @param {typeof fetch} [params.fetchImpl]
 * @returns {Promise<any>}
 */
async function callGeminiStructuredApi({
  apiKey,
  model,
  prompt,
  responseSchema,
  fetchImpl = globalThis.fetch,
}) {
  if (typeof fetchImpl !== 'function') {
    throw new StoryGeneratorError(
      '目前執行環境不支援原生 fetch()，無法呼叫 Gemini API。',
      'FETCH_UNAVAILABLE'
    );
  }

  const endpoint = `${GEMINI_API_BASE_URL}/${encodeURIComponent(model)}:generateContent`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  const payload = {
    contents: [
      {
        role: 'user',
        parts: [{ text: prompt }],
      },
    ],
    generationConfig: {
      temperature: 0.7,
      responseMimeType: 'application/json',
      responseSchema,
    },
  };

  let response;
  try {
    response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } catch (error) {
    if (error && error.name === 'AbortError') {
      throw new StoryGeneratorError(
        '請求逾時（超過 45 秒），請檢查網路連線或稍後再試。',
        'TIMEOUT'
      );
    }
    throw new StoryGeneratorError(
      '網路連線異常，無法連接至 Gemini API，請確認網路狀態後再試。',
      'NETWORK_ERROR'
    );
  } finally {
    clearTimeout(timeoutId);
  }

  let data = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }

  if (!response.ok) {
    const apiErrorMessage = data?.error?.message || '';
    throw createHttpError(response.status, apiErrorMessage);
  }

  if (data?.promptFeedback?.blockReason) {
    throw new StoryGeneratorError(
      '請求內容遭 Gemini 安全機制過濾，請調整單字或風格 Prompt 後重試。',
      'SAFETY_BLOCKED'
    );
  }

  const candidate = data?.candidates?.[0];
  if (!candidate) {
    throw new StoryGeneratorError(
      'Gemini 未回傳任何生成結果，請稍後重試。',
      'EMPTY_CANDIDATES'
    );
  }

  if (candidate.finishReason === 'SAFETY' || candidate.finishReason === 'RECITATION') {
    throw new StoryGeneratorError(
      '生成內容因安全或版權過濾被中斷，請調整風格 Prompt 後重試。',
      'CONTENT_FILTERED'
    );
  }

  const rawText = candidate?.content?.parts
    ?.map((part) => (typeof part.text === 'string' ? part.text : ''))
    .join('');

  return parseGeminiJson(rawText);
}

/**
 * 產生托福單字學習組（新單字卡、新單字文章與分批複習文章）。
 *
 * @param {string[]|string} newWords 0～5 個新單字
 * @param {string[]|string} [reviewWords=[]] 0 到多個複習單字（每 6 字自動分批）
 * @param {string} apiKey 使用者的 Gemini API Key
 * @param {object} [options={}] 額外設定
 * @param {string} [options.stylePrompt] 自訂文章風格 Prompt
 * @param {string} [options.model] 指定 Gemini 模型名稱（預設使用 DEFAULT_MODEL）
 * @param {(message: string) => void} [options.onProgress] 進度回呼函式
 * @param {typeof fetch} [options.fetchImpl] 選填 fetch 實作（供測試注入）
 * @returns {Promise<{
 *   model: string,
 *   stylePromptUsed: string,
 *   newWords: string[],
 *   reviewWords: string[],
 *   newWordCards: Array<{ word: string, chinese: string, mnemonic: string, example: string }>,
 *   newWordsArticle: { title: string, content: string, targetWords: string[], missingWords: string[] } | null,
 *   reviewArticles: Array<{ batchIndex: number, title: string, content: string, targetWords: string[], missingWords: string[] }>
 * }>}
 */
export async function generateStudySet(newWords = [], reviewWords = [], apiKey = '', options = {}) {
  const trimmedApiKey = typeof apiKey === 'string' ? apiKey.trim() : '';
  if (!trimmedApiKey) {
    throw new StoryGeneratorError(
      '請先輸入並儲存您的 Gemini API Key。',
      'MISSING_API_KEY'
    );
  }

  const cleanedNewWords = normalizeWords(newWords);
  if (cleanedNewWords.length > MAX_NEW_WORDS) {
    throw new StoryGeneratorError(
      `新單字最多只能輸入 ${MAX_NEW_WORDS} 個（去重後目前為 ${cleanedNewWords.length} 個）。`,
      'TOO_MANY_NEW_WORDS'
    );
  }

  const newWordLowerSet = new Set(cleanedNewWords.map((word) => word.toLowerCase()));
  const cleanedReviewWords = normalizeWords(reviewWords).filter(
    (word) => !newWordLowerSet.has(word.toLowerCase())
  );

  if (cleanedNewWords.length === 0 && cleanedReviewWords.length === 0) {
    throw new StoryGeneratorError(
      '請至少輸入 1 個新單字或複習單字。',
      'EMPTY_WORDS'
    );
  }

  const effectiveModel =
    typeof options.model === 'string' && options.model.trim()
      ? options.model.trim()
      : DEFAULT_MODEL;

  const effectiveStylePrompt =
    typeof options.stylePrompt === 'string' && options.stylePrompt.trim()
      ? options.stylePrompt.trim()
      : DEFAULT_STYLE_PROMPT;

  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : null;
  const fetchImpl = options.fetchImpl || globalThis.fetch;

  let newWordCards = [];
  let newWordsArticle = null;

  // 1. 若有新單字（1～5 個），生成新單字卡與新單字文章；若為 0 個則跳過
  if (cleanedNewWords.length > 0) {
    onProgress?.(`正在生成 ${cleanedNewWords.length} 張新單字卡與新單字短文…`);

    const newWordsResult = await callGeminiStructuredApi({
      apiKey: trimmedApiKey,
      model: effectiveModel,
      prompt: buildNewWordsPrompt(cleanedNewWords, effectiveStylePrompt),
      responseSchema: buildNewWordsResponseSchema(),
      fetchImpl,
    });

    const rawCards = Array.isArray(newWordsResult?.newWordCards)
      ? newWordsResult.newWordCards
      : [];

    newWordCards = rawCards.map((card) => ({
      word: typeof card?.word === 'string' ? card.word.trim() : '',
      chinese: typeof card?.chinese === 'string' ? card.chinese.trim() : '',
      mnemonic: typeof card?.mnemonic === 'string' ? card.mnemonic.trim() : '',
      example: stripMarkdownEmphasis(typeof card?.example === 'string' ? card.example : ''),
    }));

    const articleTitle =
      typeof newWordsResult?.newWordsArticle?.title === 'string' &&
      newWordsResult.newWordsArticle.title.trim()
        ? newWordsResult.newWordsArticle.title.trim()
        : 'New Vocabulary Story';

    const articleContent = stripMarkdownEmphasis(
      typeof newWordsResult?.newWordsArticle?.content === 'string'
        ? newWordsResult.newWordsArticle.content
        : ''
    );

    newWordsArticle = {
      title: articleTitle,
      content: articleContent,
      targetWords: cleanedNewWords,
      missingWords: findMissingWords(articleContent, cleanedNewWords),
    };
  }

  // 2. 若有複習單字，每 6 個字分批生成複習文章
  const reviewBatches = chunkWords(cleanedReviewWords, REVIEW_BATCH_SIZE);
  const reviewArticles = [];

  for (let i = 0; i < reviewBatches.length; i += 1) {
    const batchWords = reviewBatches[i];
    const batchIndex = i + 1;

    onProgress?.(
      `正在生成複習短文（第 ${batchIndex} / ${reviewBatches.length} 批，共 ${batchWords.length} 個單字）…`
    );

    const reviewResult = await callGeminiStructuredApi({
      apiKey: trimmedApiKey,
      model: effectiveModel,
      prompt: buildReviewArticlePrompt(
        batchWords,
        effectiveStylePrompt,
        batchIndex,
        reviewBatches.length
      ),
      responseSchema: buildReviewArticleResponseSchema(),
      fetchImpl,
    });

    const title =
      typeof reviewResult?.title === 'string' && reviewResult.title.trim()
        ? reviewResult.title.trim()
        : `Review Story #${batchIndex}`;

    const content = stripMarkdownEmphasis(
      typeof reviewResult?.content === 'string' ? reviewResult.content : ''
    );

    reviewArticles.push({
      batchIndex,
      title,
      content,
      targetWords: batchWords,
      missingWords: findMissingWords(content, batchWords),
    });
  }

  return {
    model: effectiveModel,
    stylePromptUsed: effectiveStylePrompt,
    newWords: cleanedNewWords,
    reviewWords: cleanedReviewWords,
    newWordCards,
    newWordsArticle,
    reviewArticles,
  };
}
