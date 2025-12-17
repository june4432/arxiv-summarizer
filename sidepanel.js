let rawMarkdown = '';
let currentSettings = {};
let lastUsage = null;

// 기본 설정값
const DEFAULT_SETTINGS = {
  darkMode: false,
  provider: 'n8n',
  n8nWebhookUrl: 'http://localhost:5678/webhook/12aba2b1-9817-4ba2-9d14-a4141f69a557',
  claudeModel: 'claude-sonnet-4-20250514',
  openaiModel: 'gpt-4o',
  summaryLanguage: 'korean',
  userPrompt: `당신은 AI/ML 분야 논문을 분석하고 요약하는 전문가입니다.

## 역할
- 복잡한 AI 논문을 명확하고 구조화된 형태로 요약
- 핵심 기여점과 실용적 인사이트 추출
- 기술적 깊이와 접근성의 균형 유지

## 요약 구조

### 1. 한 줄 요약
논문의 핵심을 1-2문장으로 압축

### 2. 문제 정의
- 이 논문이 해결하려는 문제는 무엇인가?
- 기존 접근법의 한계는?

### 3. 제안 방법
- 핵심 아이디어와 기법
- 기존 방법과의 차별점
- 주요 아키텍처/알고리즘 (필요시 간단한 다이어그램 설명)

### 4. 실험 결과
- 주요 벤치마크 성능
- 기존 SOTA 대비 개선점
- 주목할 만한 ablation study 결과

### 5. 실용적 시사점
- 실제 적용 가능성
- 한계점과 향후 연구 방향
- 관련 후속 논문이나 구현체 (알고 있다면)

### 6. 핵심 키워드
관련 기술 태그 5개 이내

## 응답 지침
- {{language}}로 응답해주세요
- 전문 용어는 처음 등장 시 간단히 설명
- 수식은 꼭 필요한 경우만, 직관적 설명과 함께
- 논문의 주장을 그대로 전달하되, 명백한 과장은 지적

## 논문 정보
- 제목: {{title}}
- URL: {{url}}

## 초록
{{abstract}}`
};

// 언어 매핑
const LANGUAGE_MAP = {
  korean: '한국어',
  english: 'English',
  auto: '원문 언어'
};

// 모델별 가격 (1M 토큰당 USD)
const PRICING = {
  // Claude
  'claude-sonnet-4-20250514': { input: 3, output: 15 },
  'claude-opus-4-20250514': { input: 15, output: 75 },
  'claude-3-5-haiku-20241022': { input: 0.8, output: 4 },
  // OpenAI
  'gpt-4o': { input: 2.5, output: 10 },
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
  'gpt-4-turbo': { input: 10, output: 30 },
  'o1': { input: 15, output: 60 },
  'o1-mini': { input: 3, output: 12 }
};

// 테마 적용
function applyTheme(isDark) {
  document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
}

// 설정 불러오기
async function loadSettings() {
  try {
    const syncData = await chrome.storage.sync.get([
      'darkMode', 'provider', 'n8nWebhookUrl', 'claudeModel',
      'openaiModel', 'summaryLanguage', 'userPrompt'
    ]);

    const localData = await chrome.storage.local.get([
      'claudeApiKey', 'openaiApiKey', 'lastResult'
    ]);

    currentSettings = {
      darkMode: syncData.darkMode ?? DEFAULT_SETTINGS.darkMode,
      provider: syncData.provider ?? DEFAULT_SETTINGS.provider,
      n8nWebhookUrl: syncData.n8nWebhookUrl ?? DEFAULT_SETTINGS.n8nWebhookUrl,
      claudeModel: syncData.claudeModel ?? DEFAULT_SETTINGS.claudeModel,
      openaiModel: syncData.openaiModel ?? DEFAULT_SETTINGS.openaiModel,
      summaryLanguage: syncData.summaryLanguage ?? DEFAULT_SETTINGS.summaryLanguage,
      userPrompt: syncData.userPrompt ?? DEFAULT_SETTINGS.userPrompt,
      claudeApiKey: localData.claudeApiKey ?? '',
      openaiApiKey: localData.openaiApiKey ?? ''
    };

    applyTheme(currentSettings.darkMode);
    updateProviderBadge(currentSettings.provider);

    // 마지막 결과 복원
    if (localData.lastResult) {
      rawMarkdown = localData.lastResult.markdown || '';
      lastUsage = localData.lastResult.usage || null;
      if (rawMarkdown) {
        const resultDiv = document.getElementById('result');
        const copyBtn = document.getElementById('copyBtn');
        resultDiv.innerHTML = marked.parse(rawMarkdown);
        addCodeCopyButtons();
        resultDiv.style.display = 'block';
        copyBtn.style.display = 'block';
        document.getElementById('status').textContent = '📝 이전 요약 결과';
        if (lastUsage) {
          displayTokenInfo(lastUsage, localData.lastResult.model);
        }
      }
    }
  } catch (e) {
    console.error('설정 불러오기 실패:', e);
  }
}

// 프로바이더 뱃지 업데이트
function updateProviderBadge(provider) {
  const badge = document.getElementById('providerBadge');
  const labels = { n8n: 'n8n', claude: 'Claude', openai: 'OpenAI' };
  badge.textContent = labels[provider] || provider;
}

// 프롬프트 템플릿 치환
function buildPrompt(template, data) {
  const language = LANGUAGE_MAP[currentSettings.summaryLanguage] || '한국어';
  return template
    .replace(/\{\{title\}\}/g, data.title)
    .replace(/\{\{abstract\}\}/g, data.abstract)
    .replace(/\{\{url\}\}/g, data.url)
    .replace(/\{\{language\}\}/g, language);
}

// 토큰 정보 표시
function displayTokenInfo(usage, model) {
  const tokenInfo = document.getElementById('tokenInfo');
  const pricing = PRICING[model];

  if (!usage || !pricing) {
    tokenInfo.style.display = 'none';
    return;
  }

  const inputCost = (usage.input_tokens / 1000000) * pricing.input;
  const outputCost = (usage.output_tokens / 1000000) * pricing.output;
  const totalCost = inputCost + outputCost;

  tokenInfo.innerHTML = `
    <div class="token-detail">
      <span>입력 토큰</span>
      <span>${usage.input_tokens.toLocaleString()}</span>
    </div>
    <div class="token-detail">
      <span>출력 토큰</span>
      <span>${usage.output_tokens.toLocaleString()}</span>
    </div>
    <div class="token-detail">
      <span>예상 비용</span>
      <span class="cost">$${totalCost.toFixed(4)}</span>
    </div>
  `;
  tokenInfo.style.display = 'block';
}

// n8n API 호출
async function callN8n(data) {
  const response = await fetch(currentSettings.n8nWebhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: `제목: ${data.title}\n\n초록: ${data.abstract}\n\nURL: ${data.url}`
    })
  });
  const json = await response.json();
  return { text: json.result || JSON.stringify(json, null, 2), usage: null };
}

// Claude API 스트리밍 호출
async function callClaudeStream(data, onChunk) {
  if (!currentSettings.claudeApiKey) {
    throw new Error('Claude API Key가 설정되지 않았습니다. 설정 페이지에서 입력해주세요.');
  }

  const prompt = buildPrompt(currentSettings.userPrompt, data);

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': currentSettings.claudeApiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true'
    },
    body: JSON.stringify({
      model: currentSettings.claudeModel,
      max_tokens: 4096,
      stream: true,
      messages: [{ role: 'user', content: prompt }]
    })
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error?.message || 'Claude API 오류');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let fullText = '';
  let usage = { input_tokens: 0, output_tokens: 0 };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const chunk = decoder.decode(value);
    const lines = chunk.split('\n');

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const jsonStr = line.slice(6);
        if (jsonStr === '[DONE]') continue;

        try {
          const data = JSON.parse(jsonStr);

          if (data.type === 'content_block_delta' && data.delta?.text) {
            fullText += data.delta.text;
            onChunk(fullText);
          }

          if (data.type === 'message_delta' && data.usage) {
            usage.output_tokens = data.usage.output_tokens;
          }

          if (data.type === 'message_start' && data.message?.usage) {
            usage.input_tokens = data.message.usage.input_tokens;
          }
        } catch (e) {
          // JSON 파싱 에러 무시
        }
      }
    }
  }

  return { text: fullText, usage };
}

// OpenAI API 스트리밍 호출
async function callOpenAIStream(data, onChunk) {
  if (!currentSettings.openaiApiKey) {
    throw new Error('OpenAI API Key가 설정되지 않았습니다. 설정 페이지에서 입력해주세요.');
  }

  const prompt = buildPrompt(currentSettings.userPrompt, data);

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${currentSettings.openaiApiKey}`
    },
    body: JSON.stringify({
      model: currentSettings.openaiModel,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 4096,
      stream: true,
      stream_options: { include_usage: true }
    })
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error?.message || 'OpenAI API 오류');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let fullText = '';
  let usage = { input_tokens: 0, output_tokens: 0 };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const chunk = decoder.decode(value);
    const lines = chunk.split('\n');

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const jsonStr = line.slice(6);
        if (jsonStr === '[DONE]') continue;

        try {
          const data = JSON.parse(jsonStr);

          if (data.choices?.[0]?.delta?.content) {
            fullText += data.choices[0].delta.content;
            onChunk(fullText);
          }

          if (data.usage) {
            usage.input_tokens = data.usage.prompt_tokens;
            usage.output_tokens = data.usage.completion_tokens;
          }
        } catch (e) {
          // JSON 파싱 에러 무시
        }
      }
    }
  }

  return { text: fullText, usage };
}

// 코드 블럭에 복사 버튼 추가
function addCodeCopyButtons() {
  const resultDiv = document.getElementById('result');
  const preElements = resultDiv.querySelectorAll('pre');

  preElements.forEach((pre) => {
    if (pre.parentElement.classList.contains('code-block-wrapper')) return;

    const wrapper = document.createElement('div');
    wrapper.className = 'code-block-wrapper';

    const copyBtn = document.createElement('button');
    copyBtn.className = 'code-copy-btn';
    copyBtn.textContent = '복사';
    copyBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const code = pre.textContent;
      try {
        await navigator.clipboard.writeText(code);
        copyBtn.textContent = '✓ 복사됨';
        copyBtn.classList.add('copied');
        setTimeout(() => {
          copyBtn.textContent = '복사';
          copyBtn.classList.remove('copied');
        }, 2000);
      } catch (err) {
        copyBtn.textContent = '실패';
      }
    });

    pre.parentNode.insertBefore(wrapper, pre);
    wrapper.appendChild(pre);
    wrapper.appendChild(copyBtn);
  });
}

// 결과 저장 (마지막 결과 + 히스토리)
async function saveResult(markdown, paperData, usage, model) {
  try {
    // 마지막 결과 저장
    await chrome.storage.local.set({
      lastResult: { markdown, paperData, usage, model, timestamp: Date.now() }
    });

    // 히스토리에 추가
    const { history = [] } = await chrome.storage.local.get('history');
    const newEntry = {
      id: Date.now(),
      title: paperData.title,
      url: paperData.url,
      markdown,
      usage,
      model,
      provider: currentSettings.provider,
      timestamp: Date.now()
    };

    // 최대 50개까지만 저장
    history.unshift(newEntry);
    if (history.length > 50) history.pop();

    await chrome.storage.local.set({ history });
  } catch (e) {
    console.error('결과 저장 실패:', e);
  }
}

// 히스토리 불러오기
async function loadHistory() {
  const { history = [] } = await chrome.storage.local.get('history');
  return history;
}

// 히스토리 모달 렌더링
async function renderHistoryModal() {
  const historyList = document.getElementById('historyList');
  const history = await loadHistory();

  if (history.length === 0) {
    historyList.innerHTML = '<div class="history-empty">아직 요약한 논문이 없습니다</div>';
    return;
  }

  historyList.innerHTML = history.map(item => `
    <div class="history-item" data-id="${item.id}">
      <div class="history-item-title">${item.title}</div>
      <div class="history-item-meta">
        <span>${item.provider.toUpperCase()}</span>
        <span>${new Date(item.timestamp).toLocaleDateString('ko-KR')}</span>
      </div>
      <div class="history-item-actions">
        <button class="load-btn" data-id="${item.id}">불러오기</button>
        <button class="btn-danger delete-btn" data-id="${item.id}">삭제</button>
      </div>
    </div>
  `).join('');

  // 이벤트 리스너 추가
  historyList.querySelectorAll('.load-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = parseInt(btn.dataset.id);
      const item = history.find(h => h.id === id);
      if (item) {
        rawMarkdown = item.markdown;
        lastUsage = item.usage;
        const resultDiv = document.getElementById('result');
        const copyBtn = document.getElementById('copyBtn');
        resultDiv.innerHTML = marked.parse(rawMarkdown);
        addCodeCopyButtons();
        resultDiv.style.display = 'block';
        copyBtn.style.display = 'block';
        document.getElementById('status').textContent = '📝 히스토리에서 불러옴';
        if (lastUsage && item.model) {
          displayTokenInfo(lastUsage, item.model);
        } else {
          document.getElementById('tokenInfo').style.display = 'none';
        }
        closeHistoryModal();
      }
    });
  });

  historyList.querySelectorAll('.delete-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = parseInt(btn.dataset.id);
      const { history = [] } = await chrome.storage.local.get('history');
      const newHistory = history.filter(h => h.id !== id);
      await chrome.storage.local.set({ history: newHistory });
      renderHistoryModal();
    });
  });
}

// 히스토리 모달 열기/닫기
function openHistoryModal() {
  document.getElementById('historyModal').classList.add('active');
  renderHistoryModal();
}

function closeHistoryModal() {
  document.getElementById('historyModal').classList.remove('active');
}

// 메인 요약 요청 처리
document.getElementById('send').addEventListener('click', async () => {
  const status = document.getElementById('status');
  const result = document.getElementById('result');
  const copyBtn = document.getElementById('copyBtn');
  const sendBtn = document.getElementById('send');
  const tokenInfo = document.getElementById('tokenInfo');

  await loadSettings();

  status.textContent = '⏳ 파싱 중...';
  result.style.display = 'none';
  copyBtn.style.display = 'none';
  tokenInfo.style.display = 'none';
  sendBtn.disabled = true;
  rawMarkdown = '';
  lastUsage = null;

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (!tab.url.includes('arxiv.org')) {
    status.textContent = '❌ arXiv 페이지에서 실행해주세요.';
    sendBtn.disabled = false;
    return;
  }

  const [extracted] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => {
      const title = document.querySelector('h1.title')?.textContent?.replace('Title:', '').trim();
      const abstract = document.querySelector('blockquote.abstract')?.textContent?.replace('Abstract:', '').trim();
      const url = window.location.href;
      return { title, abstract, url };
    }
  });

  const data = extracted.result;

  if (!data.title) {
    status.textContent = '❌ 논문 정보를 찾을 수 없습니다.';
    sendBtn.disabled = false;
    return;
  }

  const providerLabels = { n8n: 'n8n', claude: 'Claude', openai: 'OpenAI' };
  status.textContent = `⏳ ${providerLabels[currentSettings.provider]} 요청 중...`;

  try {
    let response;
    let model;

    const onChunk = (text) => {
      rawMarkdown = text;
      result.style.display = 'block';
      result.innerHTML = marked.parse(text);
    };

    switch (currentSettings.provider) {
      case 'claude':
        model = currentSettings.claudeModel;
        response = await callClaudeStream(data, onChunk);
        break;
      case 'openai':
        model = currentSettings.openaiModel;
        response = await callOpenAIStream(data, onChunk);
        break;
      case 'n8n':
      default:
        model = null;
        response = await callN8n(data);
        rawMarkdown = response.text;
        result.innerHTML = marked.parse(rawMarkdown);
        result.style.display = 'block';
        break;
    }

    lastUsage = response.usage;

    status.textContent = '✅ 완료!';
    copyBtn.style.display = 'block';
    addCodeCopyButtons();

    if (lastUsage && model) {
      displayTokenInfo(lastUsage, model);
    }

    await saveResult(rawMarkdown, data, lastUsage, model);

  } catch (e) {
    status.textContent = '❌ 요청 실패: ' + e.message;
  } finally {
    sendBtn.disabled = false;
  }
});

// 마크다운 복사 버튼
document.getElementById('copyBtn').addEventListener('click', async () => {
  const copyBtn = document.getElementById('copyBtn');
  try {
    await navigator.clipboard.writeText(rawMarkdown);
    copyBtn.textContent = '✅ 복사됨!';
    setTimeout(() => { copyBtn.textContent = '📋 마크다운 복사'; }, 2000);
  } catch (e) {
    copyBtn.textContent = '❌ 복사 실패';
  }
});

// 설정 버튼
document.getElementById('settingsBtn').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

// 히스토리 버튼
document.getElementById('historyBtn').addEventListener('click', openHistoryModal);
document.getElementById('closeHistory').addEventListener('click', closeHistoryModal);
document.getElementById('historyModal').addEventListener('click', (e) => {
  if (e.target.id === 'historyModal') closeHistoryModal();
});

// 전체 히스토리 삭제
document.getElementById('clearHistory').addEventListener('click', async () => {
  if (confirm('모든 히스토리를 삭제하시겠습니까?')) {
    await chrome.storage.local.set({ history: [] });
    renderHistoryModal();
  }
});

// 스토리지 변경 감지
chrome.storage.onChanged.addListener((changes) => {
  if (changes.darkMode) applyTheme(changes.darkMode.newValue);
  if (changes.provider) updateProviderBadge(changes.provider.newValue);
});

// 컨텍스트 메뉴에서 메시지 수신 처리
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'startSummarize') {
    // 요약 버튼 클릭 트리거
    document.getElementById('send').click();
  }
});

// 초기화
document.addEventListener('DOMContentLoaded', loadSettings);
