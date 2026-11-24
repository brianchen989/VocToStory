/**
 * renderer.js
 * 畫面模塊：專責將資料安全地渲染成 HTML（單字卡、文章、漏字提醒、Loading 與錯誤訊息）。
 */

/**
 * 跳脫 HTML 特殊字元以防止 XSS。
 * @param {string} value
 * @returns {string}
 */
function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * 將純文字文章依換行轉為乾淨的段落 HTML（不特別標記單字）。
 * @param {string} content
 * @returns {string}
 */
function formatArticleParagraphs(content) {
  const cleanText = String(content ?? '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .trim();

  if (!cleanText) {
    return '<p class="article-paragraph">（無文章內容）</p>';
  }

  const paragraphs = cleanText
    .split(/\n{2,}|\r\n\r\n/)
    .map((p) => p.trim())
    .filter(Boolean);

  return paragraphs
    .map((paragraph) => {
      const safeParagraph = escapeHtml(paragraph).replace(/\r?\n/g, '<br>');
      return `<p class="article-paragraph">${safeParagraph}</p>`;
    })
    .join('');
}

/**
 * 渲染目標單字標籤列表。
 * @param {string[]} targetWords
 * @returns {string}
 */
function renderTargetWordsList(targetWords) {
  if (!Array.isArray(targetWords) || targetWords.length === 0) {
    return '';
  }

  const pills = targetWords
    .map((word) => `<span class="word-pill">${escapeHtml(word)}</span>`)
    .join('');

  return `
    <div class="article-meta">
      <span class="meta-label">本篇目標單字：</span>
      <div class="pill-group">${pills}</div>
    </div>
  `;
}

/**
 * 渲染文章下方的漏字檢查結果區塊。
 * @param {string[]} missingWords
 * @returns {string}
 */
function renderMissingWordsFooter(missingWords) {
  if (Array.isArray(missingWords) && missingWords.length > 0) {
    const badges = missingWords
      .map((word) => `<span class="missing-badge">${escapeHtml(word)}</span>`)
      .join('');

    return `
      <div class="article-footer article-footer--warning" role="alert">
        <span class="footer-icon" aria-hidden="true">⚠</span>
        <div class="footer-body">
          <strong>提醒：本篇文章可能漏掉了以下目標單字</strong>
          <div class="pill-group">${badges}</div>
        </div>
      </div>
    `;
  }

  return `
    <div class="article-footer article-footer--ok">
      <span class="footer-icon" aria-hidden="true">✓</span>
      <span>漏字檢查通過：本篇已涵蓋全部目標單字。</span>
    </div>
  `;
}

/**
 * 渲染單一文章卡片（適用於新單字文章與複習文章）。
 * @param {object} options
 * @param {string} options.badgeText
 * @param {string} options.badgeVariant
 * @param {string} options.title
 * @param {string} options.content
 * @param {string[]} options.targetWords
 * @param {string[]} options.missingWords
 * @returns {string}
 */
function renderArticleCard({
  badgeText,
  badgeVariant,
  title,
  content,
  targetWords,
  missingWords,
}) {
  return `
    <article class="article-card">
      <div class="article-header">
        <span class="section-badge section-badge--${escapeHtml(badgeVariant)}">${escapeHtml(badgeText)}</span>
        <h3 class="article-title">${escapeHtml(title)}</h3>
      </div>
      ${renderTargetWordsList(targetWords)}
      <div class="article-body">
        ${formatArticleParagraphs(content)}
      </div>
      ${renderMissingWordsFooter(missingWords)}
    </article>
  `;
}

/**
 * 清空指定容器內容。
 * @param {HTMLElement|null} container
 */
export function clearContainer(container) {
  if (!container) {
    return;
  }
  container.innerHTML = '';
}

/**
 * 更新小區塊狀態提示（例如 API Key 或風格 Prompt 的儲存回饋）。
 * @param {HTMLElement|null} element
 * @param {string} message
 * @param {'info'|'success'|'error'} [type='info']
 */
export function renderStatusMessage(element, message, type = 'info') {
  if (!element) {
    return;
  }

  element.textContent = message;
  element.className = `status-message status-message--${type}`;
}

/**
 * 渲染載入中狀態與進度文字。
 * @param {HTMLElement|null} container
 * @param {string} [message='正在生成學習內容，請稍候…']
 */
export function renderLoading(container, message = '正在生成學習內容，請稍候…') {
  if (!container) {
    return;
  }

  container.innerHTML = `
    <div class="loading-box" role="status" aria-live="polite">
      <div class="spinner" aria-hidden="true"></div>
      <div class="loading-text">
        <p class="loading-title">${escapeHtml(message)}</p>
        <p class="loading-subtitle">正在呼叫 Gemini 生成自然流暢的高中 7000 單語境短文…</p>
      </div>
    </div>
  `;
}

/**
 * 渲染繁體中文錯誤提示橫幅。
 * @param {HTMLElement|null} container
 * @param {string} message
 */
export function renderError(container, message) {
  if (!container) {
    return;
  }

  container.innerHTML = `
    <div class="error-banner" role="alert">
      <div class="error-banner__title">發生錯誤</div>
      <p class="error-banner__message">${escapeHtml(message)}</p>
    </div>
  `;
}

/**
 * 渲染完整學習組結果（新單字卡、新單字文章與分批複習文章）。
 * @param {HTMLElement|null} container
 * @param {object} studySet
 */
export function renderStudySet(container, studySet) {
  if (!container || !studySet) {
    return;
  }

  const sections = [];

  // 1. 新單字學習卡（僅在有新單字時渲染）
  if (Array.isArray(studySet.newWordCards) && studySet.newWordCards.length > 0) {
    const cardsHtml = studySet.newWordCards
      .map(
        (card, index) => `
          <div class="vocab-card">
            <div class="vocab-card__header">
              <span class="vocab-card__index">#${index + 1}</span>
              <h3 class="vocab-card__word">${escapeHtml(card.word)}</h3>
            </div>
            <p class="vocab-card__chinese">${escapeHtml(card.chinese)}</p>
            <div class="vocab-card__block">
              <span class="vocab-card__label">記憶法／字根聯想</span>
              <p class="vocab-card__text">${escapeHtml(card.mnemonic)}</p>
            </div>
            <div class="vocab-card__block vocab-card__block--example">
              <span class="vocab-card__label">托福例句</span>
              <p class="vocab-card__example">${escapeHtml(card.example)}</p>
            </div>
          </div>
        `
      )
      .join('');

    sections.push(`
      <section class="result-section" aria-labelledby="new-cards-heading">
        <div class="result-section__header">
          <h2 id="new-cards-heading">新單字學習卡</h2>
          <span class="count-chip">共 ${studySet.newWordCards.length} 張</span>
        </div>
        <div class="vocab-grid">
          ${cardsHtml}
        </div>
      </section>
    `);
  }

  // 2. 新單字文章（若 newWords 為空則略過）
  if (studySet.newWordsArticle) {
    sections.push(`
      <section class="result-section" aria-labelledby="new-article-heading">
        <div class="result-section__header">
          <h2 id="new-article-heading">新單字閱讀文章</h2>
          <span class="count-chip">模型：${escapeHtml(studySet.model)}</span>
        </div>
        ${renderArticleCard({
          badgeText: '新單字短文',
          badgeVariant: 'primary',
          title: studySet.newWordsArticle.title,
          content: studySet.newWordsArticle.content,
          targetWords: studySet.newWordsArticle.targetWords,
          missingWords: studySet.newWordsArticle.missingWords,
        })}
      </section>
    `);
  }

  // 3. 複習文章列表（若有複習單字）
  if (Array.isArray(studySet.reviewArticles) && studySet.reviewArticles.length > 0) {
    const reviewHtml = studySet.reviewArticles
      .map((article) =>
        renderArticleCard({
          badgeText: `複習短文 第 ${article.batchIndex} 批`,
          badgeVariant: 'secondary',
          title: article.title,
          content: article.content,
          targetWords: article.targetWords,
          missingWords: article.missingWords,
        })
      )
      .join('');

    sections.push(`
      <section class="result-section" aria-labelledby="review-articles-heading">
        <div class="result-section__header">
          <h2 id="review-articles-heading">複習單字閱讀文章</h2>
          <span class="count-chip">共 ${studySet.reviewArticles.length} 批（每批最多 6 字）</span>
        </div>
        <div class="review-list">
          ${reviewHtml}
        </div>
      </section>
    `);
  }

  container.innerHTML = sections.join('');
}
