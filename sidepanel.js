let currentSettings = {};
let currentTab = 'abstract';
let isTabSwitching = false; // 탭 전환 중 플래그

// 탭별 상태 관리
const tabState = {
  abstract: {
    markdown: '',
    usage: null,
    model: null,
    paperData: null,
    isLoading: false
  },
  full: {
    markdown: '',
    usage: null,
    model: null,
    paperData: null,
    isLoading: false
  }
};

// Claude OAuth 토큰 감지 및 요청 빌더
function isClaudeOAuthToken(apiKey) {
  return apiKey && apiKey.startsWith('sk-ant-oat');
}

const CLAUDE_OAUTH_SYSTEM_PROMPT = 'You are Claude Code, Anthropic\'s official CLI for Claude.';

function buildClaudeFetchOptions(apiKey, model, maxTokens, prompt, stream = true) {
  const isOAuth = isClaudeOAuthToken(apiKey);

  if (isOAuth) {
    return {
      url: 'https://api.anthropic.com/v1/messages?beta=true',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'text/event-stream',
        'Authorization': `Bearer ${apiKey}`,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'oauth-2025-04-20,interleaved-thinking-2025-05-14,claude-code-20250219,token-efficient-tools-2025-02-19',
        'User-Agent': 'claude-cli/2.1.33',
        'x-app': 'cli'
      },
      body: {
        model,
        max_tokens: maxTokens,
        stream,
        system: [{ type: 'text', text: CLAUDE_OAUTH_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: prompt }]
      }
    };
  }

  return {
    url: 'https://api.anthropic.com/v1/messages',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: {
      model,
      max_tokens: maxTokens,
      stream,
      messages: [{ role: 'user', content: prompt }]
    }
  };
}

// Background service worker를 통한 스트리밍 프록시 (OAuth CORS 우회)
function streamClaudeViaBackground(fetchOpts, onChunk) {
  return new Promise((resolve, reject) => {
    const port = chrome.runtime.connect({ name: 'claude-api-proxy' });
    let fullText = '';
    let usage = { input_tokens: 0, output_tokens: 0 };

    port.onMessage.addListener((msg) => {
      switch (msg.type) {
        case 'delta':
          fullText += msg.text;
          onChunk(fullText);
          break;
        case 'usage_input':
          usage.input_tokens = msg.input_tokens;
          break;
        case 'usage_output':
          usage.output_tokens = msg.output_tokens;
          break;
        case 'done':
          port.disconnect();
          resolve({ text: fullText, usage });
          break;
        case 'error':
          port.disconnect();
          reject(new Error(msg.error));
          break;
      }
    });

    port.postMessage({ url: fetchOpts.url, headers: fetchOpts.headers, body: fetchOpts.body });
  });
}

// 기본 설정값
const DEFAULT_SETTINGS = {
  darkMode: false,
  provider: 'n8n',
  n8nWebhookUrl: 'http://localhost:5678/webhook/12aba2b1-9817-4ba2-9d14-a4141f69a557',
  atlasUrl: '',
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
- 제목은 반드시 #, ##, ### 만 사용 (####는 사용 금지)

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

// 전문 분석용 프롬프트
const FULL_ANALYSIS_PROMPT = `당신은 AI/ML 분야 논문을 심층 분석하는 전문가입니다.

## 역할
- 논문 전문을 읽고 깊이 있는 분석 제공
- 핵심 기여점, 방법론, 실험 결과를 상세히 설명
- 기술적 깊이와 접근성의 균형 유지

## 분석 구조

### 1. 핵심 요약 (Executive Summary)
논문의 핵심을 3-5문장으로 압축

### 2. 연구 배경 및 동기
- 이 연구가 필요한 이유
- 기존 연구의 한계점
- 연구 질문 또는 가설

### 3. 제안 방법론 (상세)
- 전체 아키텍처/프레임워크 설명
- 핵심 알고리즘 및 수식 (있다면 직관적 설명과 함께)
- 기존 방법과의 차별점
- 구현 세부사항 (학습 방법, 하이퍼파라미터 등)

### 4. 실험 설계 및 결과
- 데이터셋 및 평가 지표
- 주요 실험 결과 (수치 포함)
- Baseline 대비 성능 비교
- Ablation study 결과 및 인사이트

### 5. 주요 Figure/Table 분석
논문의 핵심 Figure나 Table에서 얻을 수 있는 인사이트

### 6. 강점 및 한계
- 이 연구의 주요 강점
- 한계점 및 개선 가능한 부분
- 저자가 언급한 future work

### 7. 실용적 시사점
- 실제 적용 가능성
- 재현 가능성 (코드 공개 여부 등)
- 관련 후속 연구 방향

### 8. 핵심 키워드
관련 기술 태그 5-7개

## 응답 지침
- {{language}}로 응답해주세요
- 전문 용어는 처음 등장 시 간단히 설명
- 수식은 직관적 설명과 함께 제공
- 논문의 주장을 그대로 전달하되, 명백한 과장은 지적
- 가능하면 구체적인 수치와 함께 설명
- 제목은 반드시 #, ##, ### 만 사용 (####는 사용 금지)

## 논문 정보
- 제목: {{title}}
- URL: {{url}}

## 논문 전문
{{fullText}}`;

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

// 토스트 알림 표시
function showToast(message, type = 'success') {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => { toast.remove(); }, 3000);
}

// 테마 적용
function applyTheme(isDark) {
  document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
}

// 설정 불러오기 (설정만, 결과 복원 X)
async function loadSettings() {
  try {
    const syncData = await chrome.storage.sync.get([
      'darkMode', 'provider', 'n8nWebhookUrl', 'atlasUrl', 'claudeModel',
      'openaiModel', 'summaryLanguage', 'userPrompt'
    ]);

    const localData = await chrome.storage.local.get([
      'claudeApiKey', 'openaiApiKey'
    ]);

    currentSettings = {
      darkMode: syncData.darkMode ?? DEFAULT_SETTINGS.darkMode,
      provider: syncData.provider ?? DEFAULT_SETTINGS.provider,
      n8nWebhookUrl: syncData.n8nWebhookUrl ?? DEFAULT_SETTINGS.n8nWebhookUrl,
      atlasUrl: syncData.atlasUrl ?? DEFAULT_SETTINGS.atlasUrl,
      claudeModel: syncData.claudeModel ?? DEFAULT_SETTINGS.claudeModel,
      openaiModel: syncData.openaiModel ?? DEFAULT_SETTINGS.openaiModel,
      summaryLanguage: syncData.summaryLanguage ?? DEFAULT_SETTINGS.summaryLanguage,
      userPrompt: syncData.userPrompt ?? DEFAULT_SETTINGS.userPrompt,
      claudeApiKey: localData.claudeApiKey ?? '',
      openaiApiKey: localData.openaiApiKey ?? ''
    };

    applyTheme(currentSettings.darkMode);
    updateProviderBadge(currentSettings.provider);
  } catch (e) {
    console.error('설정 불러오기 실패:', e);
  }
}

// 초기화 시 마지막 결과 복원
async function restoreLastResult() {
  try {
    const { lastResult } = await chrome.storage.local.get('lastResult');
    if (lastResult) {
      const lastTab = lastResult.tab || 'abstract';
      tabState[lastTab].markdown = lastResult.markdown || '';
      tabState[lastTab].usage = lastResult.usage || null;
      tabState[lastTab].model = lastResult.model || null;
      tabState[lastTab].paperData = lastResult.paperData || null;

      if (tabState[lastTab].markdown) {
        currentTab = lastTab;
        updateTabUI();
        displayTabResult(lastTab);
        document.getElementById('status').textContent = '📝 이전 결과';
      }
    }
  } catch (e) {
    console.error('결과 복원 실패:', e);
  }
}

// 프로바이더 뱃지 업데이트
function updateProviderBadge(provider) {
  const badge = document.getElementById('providerBadge');
  const labels = { n8n: 'n8n', atlas: 'Atlas', claude: 'Claude', openai: 'OpenAI' };
  badge.textContent = labels[provider] || provider;
}

// 탭 UI 업데이트
function updateTabUI() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    const tab = btn.dataset.tab;
    btn.classList.toggle('active', tab === currentTab);
    btn.classList.toggle('loading', tabState[tab].isLoading);
  });
  // 현재 탭이 로딩 중이면 시작 버튼 비활성화
  document.getElementById('startBtn').disabled = tabState[currentTab].isLoading;
}

// 로딩 UI 표시/숨김
function showLoading(text, subtext) {
  const container = document.getElementById('loadingContainer');
  const loadingText = document.getElementById('loadingText');
  const loadingSubtext = document.getElementById('loadingSubtext');
  const result = document.getElementById('result');

  loadingText.textContent = text || '요청 중...';
  loadingSubtext.textContent = subtext || '잠시만 기다려주세요';
  container.classList.add('active');
  result.style.display = 'none';
}

function hideLoading() {
  const container = document.getElementById('loadingContainer');
  container.classList.remove('active');
}

// 탭 결과 표시 (로딩 상태 포함)
function displayTabResult(tab) {
  const state = tabState[tab];
  const resultDiv = document.getElementById('result');
  const copyBtn = document.getElementById('copyBtn');
  const viewPaperBtn = document.getElementById('viewPaperBtn');
  const notionSaveBtn = document.getElementById('notionSaveBtn');
  const status = document.getElementById('status');

  if (state.markdown) {
    resultDiv.innerHTML = marked.parse(state.markdown);
    addCodeCopyButtons();
    resultDiv.style.display = 'block';
    copyBtn.disabled = false;
    notionSaveBtn.disabled = false;
    if (state.usage && state.model) {
      displayTokenInfo(state.usage, state.model);
    } else {
      document.getElementById('tokenInfo').style.display = 'none';
    }
  } else {
    resultDiv.style.display = 'none';
    resultDiv.innerHTML = '';
    copyBtn.disabled = true;
    notionSaveBtn.disabled = true;
    document.getElementById('tokenInfo').style.display = 'none';
  }

  // 논문 보기 버튼 활성화 (paperData가 있으면)
  viewPaperBtn.disabled = !state.paperData?.url;

  // 로딩 상태 표시
  if (state.isLoading) {
    status.textContent = tab === 'abstract' ? '⏳ 초록 요약 중...' : '⏳ 전문 분석 중...';
  }
}

// 현재 탭의 마크다운 가져오기
function getCurrentMarkdown() {
  return tabState[currentTab].markdown;
}

// URL에서 arXiv 논문 ID 추출
function extractPaperId(url) {
  if (!url) return null;
  const match = url.match(/arxiv\.org\/(?:abs|html|pdf)\/([^\/?#]+)/);
  return match ? match[1] : null;
}

// 현재 탭에 맞는 논문 URL 가져오기
function getPaperUrl() {
  const state = tabState[currentTab];
  if (!state.paperData?.url) return null;

  const paperId = extractPaperId(state.paperData.url);
  if (!paperId) return state.paperData.url;

  // 전문 분석 탭이면 html URL, 아니면 abs URL
  if (currentTab === 'full') {
    return `https://arxiv.org/html/${paperId}`;
  }
  return `https://arxiv.org/abs/${paperId}`;
}

// 현재 브라우저 탭의 논문에 대한 히스토리 찾기
async function loadHistoryForCurrentPage(tab) {
  const [browserTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!browserTab?.url?.includes('arxiv.org')) return null;

  const currentPaperId = extractPaperId(browserTab.url);
  if (!currentPaperId) return null;

  const history = await loadHistory();
  return history.find(item => {
    const itemPaperId = extractPaperId(item.url);
    return itemPaperId === currentPaperId && (item.tab || 'abstract') === tab;
  });
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

// 토큰 정보 표시 (비활성화)
function displayTokenInfo(usage, model) {
  // 토큰 정보 표시 안함
  return;
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

// Atlas API 스트리밍 호출 (초록 요약)
async function callAtlasStream(data, onChunk) {
  if (!currentSettings.atlasUrl) {
    throw new Error('Atlas URL이 설정되지 않았습니다. 설정 페이지에서 입력해주세요.');
  }

  const prompt = buildPrompt(currentSettings.userPrompt, data);

  const response = await fetch(currentSettings.atlasUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: prompt
    })
  });

  if (!response.ok) {
    throw new Error(`Atlas API 오류: ${response.status}`);
  }

  const contentType = response.headers.get('content-type') || '';

  // 스트리밍 응답인 경우
  if (contentType.includes('text/event-stream') || contentType.includes('text/plain') || !contentType.includes('application/json')) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let fullText = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      fullText += chunk;
      onChunk(fullText);
    }

    return { text: fullText, usage: null };
  }

  // JSON 응답인 경우 (스트리밍 미지원 서버)
  const json = await response.json();
  const text = json.message || json.result || JSON.stringify(json, null, 2);
  onChunk(text);
  return { text, usage: null };
}

// Atlas API 스트리밍 호출 (전문 분석)
async function callAtlasFullAnalysisStream(data, onChunk) {
  if (!currentSettings.atlasUrl) {
    throw new Error('Atlas URL이 설정되지 않았습니다. 설정 페이지에서 입력해주세요.');
  }

  const prompt = buildFullAnalysisPrompt(data);

  const response = await fetch(currentSettings.atlasUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: prompt
    })
  });

  if (!response.ok) {
    throw new Error(`Atlas API 오류: ${response.status}`);
  }

  const contentType = response.headers.get('content-type') || '';

  // 스트리밍 응답인 경우
  if (contentType.includes('text/event-stream') || contentType.includes('text/plain') || !contentType.includes('application/json')) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let fullText = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      fullText += chunk;
      onChunk(fullText);
    }

    return { text: fullText, usage: null };
  }

  // JSON 응답인 경우 (스트리밍 미지원 서버)
  const json = await response.json();
  const text = json.message || json.result || JSON.stringify(json, null, 2);
  onChunk(text);
  return { text, usage: null };
}

// Claude API 스트리밍 호출
async function callClaudeStream(data, onChunk) {
  if (!currentSettings.claudeApiKey) {
    throw new Error('Claude API Key가 설정되지 않았습니다. 설정 페이지에서 입력해주세요.');
  }

  const prompt = buildPrompt(currentSettings.userPrompt, data);
  const fetchOpts = buildClaudeFetchOptions(currentSettings.claudeApiKey, currentSettings.claudeModel, 4096, prompt);

  // CORS 우회를 위해 모든 Claude 요청은 background proxy 경유
  return streamClaudeViaBackground(fetchOpts, onChunk);
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

// arXiv HTML 페이지에서 전문 가져오기
async function fetchArxivFullText(arxivUrl) {
  // abs URL에서 논문 ID 추출
  const match = arxivUrl.match(/arxiv\.org\/abs\/([^\/?#]+)/);
  if (!match) {
    throw new Error('arXiv 논문 ID를 찾을 수 없습니다.');
  }

  const paperId = match[1];
  const htmlUrl = `https://arxiv.org/html/${paperId}`;

  const response = await fetch(htmlUrl);

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error('이 논문은 HTML 버전이 없습니다. 초록 요약을 이용해주세요.');
    }
    throw new Error(`HTML 페이지 로드 실패: ${response.status}`);
  }

  const html = await response.text();
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');

  // 본문 추출 (article 태그 또는 main 콘텐츠)
  const article = doc.querySelector('article') || doc.querySelector('.ltx_document') || doc.querySelector('main');

  if (!article) {
    throw new Error('논문 본문을 찾을 수 없습니다.');
  }

  // 불필요한 요소 제거
  article.querySelectorAll('script, style, nav, header, footer, .ltx_bibliography').forEach(el => el.remove());

  // 텍스트 추출 및 정리
  let text = article.innerText || article.textContent;

  // 연속된 공백/줄바꿈 정리
  text = text.replace(/\n{3,}/g, '\n\n').replace(/[ \t]+/g, ' ').trim();

  // 너무 길면 잘라내기 (약 100K 토큰 = 약 400K 문자 제한)
  const maxLength = 400000;
  if (text.length > maxLength) {
    text = text.substring(0, maxLength) + '\n\n[... 이하 생략됨 ...]';
  }

  return text;
}

// 전문 분석용 프롬프트 빌드
function buildFullAnalysisPrompt(data) {
  const language = LANGUAGE_MAP[currentSettings.summaryLanguage] || '한국어';
  return FULL_ANALYSIS_PROMPT
    .replace(/\{\{title\}\}/g, data.title)
    .replace(/\{\{url\}\}/g, data.url)
    .replace(/\{\{fullText\}\}/g, data.fullText)
    .replace(/\{\{language\}\}/g, language);
}

// Claude API 전문 분석 스트리밍 호출
async function callClaudeFullAnalysis(data, onChunk) {
  if (!currentSettings.claudeApiKey) {
    throw new Error('Claude API Key가 설정되지 않았습니다. 설정 페이지에서 입력해주세요.');
  }

  const prompt = buildFullAnalysisPrompt(data);
  const fetchOpts = buildClaudeFetchOptions(currentSettings.claudeApiKey, currentSettings.claudeModel, 8192, prompt);

  // CORS 우회를 위해 모든 Claude 요청은 background proxy 경유
  return streamClaudeViaBackground(fetchOpts, onChunk);
}

// OpenAI API 전문 분석 스트리밍 호출
async function callOpenAIFullAnalysis(data, onChunk) {
  if (!currentSettings.openaiApiKey) {
    throw new Error('OpenAI API Key가 설정되지 않았습니다. 설정 페이지에서 입력해주세요.');
  }

  const prompt = buildFullAnalysisPrompt(data);

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${currentSettings.openaiApiKey}`
    },
    body: JSON.stringify({
      model: currentSettings.openaiModel,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 8192,
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
          const parsed = JSON.parse(jsonStr);

          if (parsed.choices?.[0]?.delta?.content) {
            fullText += parsed.choices[0].delta.content;
            onChunk(fullText);
          }

          if (parsed.usage) {
            usage.input_tokens = parsed.usage.prompt_tokens;
            usage.output_tokens = parsed.usage.completion_tokens;
          }
        } catch (e) {}
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
async function saveResult(markdown, paperData, usage, model, tab) {
  try {
    // 마지막 결과 저장
    await chrome.storage.local.set({
      lastResult: { markdown, paperData, usage, model, tab, timestamp: Date.now() }
    });

    // 히스토리에 추가
    const { history = [] } = await chrome.storage.local.get('history');

    // 같은 논문 ID + 같은 탭이면 기존 항목 제거 (URL 파라미터 무시)
    const currentPaperId = extractPaperId(paperData.url);
    const filteredHistory = history.filter(item => {
      const itemPaperId = extractPaperId(item.url);
      return !(itemPaperId === currentPaperId && (item.tab || 'abstract') === tab);
    });

    const newEntry = {
      id: Date.now(),
      title: paperData.title,
      url: paperData.url,
      markdown,
      usage,
      model,
      tab,
      provider: currentSettings.provider,
      timestamp: Date.now()
    };

    // 히스토리에 추가
    filteredHistory.unshift(newEntry);

    // 스토리지 용량 관리 (최대 4MB, 최대 50개)
    const MAX_STORAGE_BYTES = 4 * 1024 * 1024; // 4MB
    const MAX_ITEMS = 50;

    // 개수 제한
    while (filteredHistory.length > MAX_ITEMS) {
      filteredHistory.pop();
    }

    // 용량 제한 (오래된 항목부터 삭제)
    while (filteredHistory.length > 1) {
      const size = new Blob([JSON.stringify(filteredHistory)]).size;
      if (size <= MAX_STORAGE_BYTES) break;
      filteredHistory.pop();
    }

    await chrome.storage.local.set({ history: filteredHistory });
  } catch (e) {
    console.error('결과 저장 실패:', e);
  }
}

// 히스토리 불러오기
async function loadHistory() {
  const { history = [] } = await chrome.storage.local.get('history');
  return history;
}

// 현재 히스토리 필터
let historyFilter = 'all';

// 히스토리 모달 렌더링
async function renderHistoryModal() {
  const historyList = document.getElementById('historyList');
  const allHistory = await loadHistory();

  // 필터 적용
  const history = historyFilter === 'all'
    ? allHistory
    : allHistory.filter(item => (item.tab || 'abstract') === historyFilter);

  if (history.length === 0) {
    const emptyMsg = historyFilter === 'all'
      ? '아직 요약한 논문이 없습니다'
      : `${historyFilter === 'full' ? '전문 분석' : '초록 요약'} 히스토리가 없습니다`;
    historyList.innerHTML = `<div class="history-empty">${emptyMsg}</div>`;
    return;
  }

  historyList.innerHTML = history.map(item => {
    const tabLabel = item.tab === 'full' ? '📚 전문' : '📝 초록';
    return `
    <div class="history-item" data-id="${item.id}">
      <div class="history-item-title">${item.title}</div>
      <div class="history-item-meta">
        <span class="history-type-badge ${item.tab || 'abstract'}">${tabLabel}</span>
        <span>${item.provider.toUpperCase()}</span>
        <span>${new Date(item.timestamp).toLocaleDateString('ko-KR')}</span>
      </div>
      <div class="history-item-actions">
        <button class="load-btn" data-id="${item.id}">불러오기</button>
        <button class="btn-notion-save" data-id="${item.id}">📓</button>
        <button class="btn-danger delete-btn" data-id="${item.id}">삭제</button>
      </div>
    </div>
  `}).join('');

  // 이벤트 리스너 추가
  historyList.querySelectorAll('.load-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = parseInt(btn.dataset.id);
      const item = allHistory.find(h => h.id === id);
      if (item) {
        const tab = item.tab || 'abstract';
        tabState[tab].markdown = item.markdown;
        tabState[tab].usage = item.usage;
        tabState[tab].model = item.model;
        tabState[tab].paperData = { title: item.title, url: item.url };
        // 현재 탭 유지, 해당 탭 데이터만 로드
        if (currentTab === tab) {
          displayTabResult(tab);
        }
        const tabLabel = tab === 'full' ? '전문 분석' : '초록 요약';
        document.getElementById('status').textContent = `📝 ${tabLabel} 불러옴`;
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

  // Notion 저장 버튼
  historyList.querySelectorAll('.btn-notion-save').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = parseInt(btn.dataset.id);
      const item = allHistory.find(h => h.id === id);
      if (item) {
        btn.disabled = true;
        btn.textContent = '⏳';
        try {
          await saveToNotion(item);
          btn.textContent = '✅';
          showToast('📓 Notion에 저장되었습니다!', 'success');
          setTimeout(() => { btn.textContent = '📓'; btn.disabled = false; }, 2000);
        } catch (err) {
          btn.textContent = '❌';
          showToast('Notion 저장 실패: ' + err.message, 'error');
          setTimeout(() => { btn.textContent = '📓'; btn.disabled = false; }, 2000);
        }
      }
    });
  });
}

// 히스토리 모달 열기/닫기
function openHistoryModal() {
  document.getElementById('historyModal').classList.add('active');
  document.body.style.overflow = 'hidden'; // 배경 스크롤 막기
  historyFilter = 'all';
  updateHistoryTabUI();
  renderHistoryModal();
}

function closeHistoryModal() {
  document.getElementById('historyModal').classList.remove('active');
  document.body.style.overflow = ''; // 배경 스크롤 복원
}

// 히스토리 탭 UI 업데이트
function updateHistoryTabUI() {
  document.querySelectorAll('.history-tab').forEach(tab => {
    tab.classList.toggle('active', tab.dataset.filter === historyFilter);
  });
}

// 히스토리 탭 클릭 핸들러
function handleHistoryTabClick(filter) {
  historyFilter = filter;
  updateHistoryTabUI();
  renderHistoryModal();
}

// 초록 요약 분석 실행
async function runAbstractAnalysis() {
  const TAB = 'abstract';
  const status = document.getElementById('status');
  const result = document.getElementById('result');
  const copyBtn = document.getElementById('copyBtn');
  const tokenInfo = document.getElementById('tokenInfo');

  await loadSettings();

  // 로딩 상태 설정
  tabState[TAB].isLoading = true;
  updateTabUI();

  // 현재 탭이면 UI 초기화
  if (currentTab === TAB) {
    status.textContent = '';
    showLoading('논문 정보 파싱 중...', 'arXiv 페이지에서 정보를 추출합니다');
    copyBtn.disabled = true;
    tokenInfo.style.display = 'none';
  }

  const [browserTab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (!browserTab.url.includes('arxiv.org')) {
    if (currentTab === TAB) {
      hideLoading();
      status.textContent = '❌ arXiv 페이지에서 실행해주세요.';
    }
    tabState[TAB].isLoading = false;
    updateTabUI();
    return;
  }

  const [extracted] = await chrome.scripting.executeScript({
    target: { tabId: browserTab.id },
    func: () => {
      const title = document.querySelector('h1.title')?.textContent?.replace('Title:', '').trim();
      const abstract = document.querySelector('blockquote.abstract')?.textContent?.replace('Abstract:', '').trim();
      const url = window.location.href;
      return { title, abstract, url };
    }
  });

  const data = extracted.result;

  if (!data.title) {
    if (currentTab === TAB) {
      hideLoading();
      status.textContent = '❌ 논문 정보를 찾을 수 없습니다.';
    }
    tabState[TAB].isLoading = false;
    updateTabUI();
    return;
  }

  const providerLabels = { n8n: 'n8n', atlas: 'Atlas', claude: 'Claude', openai: 'OpenAI' };
  if (currentTab === TAB) {
    showLoading(`${providerLabels[currentSettings.provider]}에 요청 중...`, '응답을 기다리는 중입니다');
  }

  try {
    let response;
    let model;

    const onChunk = (text) => {
      tabState[TAB].markdown = text;
      // 현재 탭이 abstract일 때만 UI 업데이트
      if (currentTab === TAB) {
        hideLoading();
        result.style.display = 'block';
        result.innerHTML = marked.parse(text);
      }
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
      case 'atlas':
        model = null;
        response = await callAtlasStream(data, onChunk);
        break;
      case 'n8n':
      default:
        model = null;
        response = await callN8n(data);
        tabState[TAB].markdown = response.text;
        if (currentTab === TAB) {
          hideLoading();
          result.innerHTML = marked.parse(response.text);
          result.style.display = 'block';
        }
        break;
    }

    // 상태 저장
    tabState[TAB].usage = response.usage;
    tabState[TAB].model = model;
    tabState[TAB].paperData = data;

    // 현재 탭이면 UI 업데이트
    if (currentTab === TAB) {
      status.textContent = '✅ 완료!';
      copyBtn.disabled = false;
      addCodeCopyButtons();
      if (response.usage && model) {
        displayTokenInfo(response.usage, model);
      }
    }

    await saveResult(tabState[TAB].markdown, data, response.usage, model, TAB);

  } catch (e) {
    if (currentTab === TAB) {
      hideLoading();
      status.textContent = '❌ 요청 실패: ' + e.message;
    }
  } finally {
    tabState[TAB].isLoading = false;
    updateTabUI();
  }
}

// 전문 분석 실행
async function runFullAnalysis() {
  const TAB = 'full';
  const status = document.getElementById('status');
  const result = document.getElementById('result');
  const copyBtn = document.getElementById('copyBtn');
  const tokenInfo = document.getElementById('tokenInfo');

  await loadSettings();

  // n8n은 전문 분석 미지원
  if (currentSettings.provider === 'n8n') {
    if (currentTab === TAB) status.textContent = '❌ 전문 분석은 Atlas, Claude 또는 OpenAI에서만 사용 가능합니다.';
    return;
  }

  // 로딩 상태 설정
  tabState[TAB].isLoading = true;
  updateTabUI();

  // 현재 탭이면 UI 초기화
  if (currentTab === TAB) {
    status.textContent = '';
    showLoading('논문 HTML 가져오는 중...', 'arXiv에서 전문을 로드합니다');
    copyBtn.disabled = true;
    tokenInfo.style.display = 'none';
  }

  const [browserTab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (!browserTab.url.includes('arxiv.org')) {
    if (currentTab === TAB) {
      hideLoading();
      status.textContent = '❌ arXiv 페이지에서 실행해주세요.';
    }
    tabState[TAB].isLoading = false;
    updateTabUI();
    return;
  }

  try {
    // 기본 정보 추출
    const [extracted] = await chrome.scripting.executeScript({
      target: { tabId: browserTab.id },
      func: () => {
        const title = document.querySelector('h1.title')?.textContent?.replace('Title:', '').trim();
        const url = window.location.href;
        return { title, url };
      }
    });

    const basicData = extracted.result;

    if (!basicData.title) {
      if (currentTab === TAB) {
        hideLoading();
        status.textContent = '❌ 논문 정보를 찾을 수 없습니다.';
      }
      tabState[TAB].isLoading = false;
      updateTabUI();
      return;
    }

    // HTML에서 전문 가져오기
    if (currentTab === TAB) {
      showLoading('논문 전문 파싱 중...', '전문 내용을 분석하고 있습니다');
    }
    const fullText = await fetchArxivFullText(basicData.url);

    const data = {
      title: basicData.title,
      url: basicData.url,
      fullText
    };

    const charCount = fullText.length.toLocaleString();
    const providerLabels = { atlas: 'Atlas', claude: 'Claude', openai: 'OpenAI' };
    if (currentTab === TAB) {
      showLoading(`${providerLabels[currentSettings.provider]}에 전문 분석 요청 중...`, `${charCount}자 분량의 논문을 분석합니다`);
    }

    let response;
    let model;

    const onChunk = (text) => {
      tabState[TAB].markdown = text;
      // 현재 탭이 full일 때만 UI 업데이트
      if (currentTab === TAB) {
        hideLoading();
        result.style.display = 'block';
        result.innerHTML = marked.parse(text);
      }
    };

    switch (currentSettings.provider) {
      case 'claude':
        model = currentSettings.claudeModel;
        response = await callClaudeFullAnalysis(data, onChunk);
        break;
      case 'openai':
        model = currentSettings.openaiModel;
        response = await callOpenAIFullAnalysis(data, onChunk);
        break;
      case 'atlas':
        model = null;
        response = await callAtlasFullAnalysisStream(data, onChunk);
        break;
    }

    // 상태 저장
    tabState[TAB].usage = response.usage;
    tabState[TAB].model = model;
    tabState[TAB].paperData = { title: data.title, url: data.url, abstract: '[전문 분석]' };

    // 현재 탭이면 UI 업데이트
    if (currentTab === TAB) {
      status.textContent = '✅ 전문 분석 완료!';
      copyBtn.disabled = false;
      addCodeCopyButtons();
      if (response.usage && model) {
        displayTokenInfo(response.usage, model);
      }
    }

    await saveResult(tabState[TAB].markdown, tabState[TAB].paperData, response.usage, model, TAB);

  } catch (e) {
    if (currentTab === TAB) {
      hideLoading();
      status.textContent = '❌ 오류: ' + e.message;
    }
  } finally {
    tabState[TAB].isLoading = false;
    updateTabUI();
  }
}

// 탭 클릭 핸들러 (결과 보기만, 자동 분석 X)
async function handleTabClick(tab) {
  // 이미 전환 중이면 무시 (디바운싱)
  if (isTabSwitching) return;
  isTabSwitching = true;

  try {
    currentTab = tab;
    updateTabUI();

    // 현재 브라우저 탭의 논문 ID 확인
    const [browserTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const currentPaperId = browserTab?.url?.includes('arxiv.org') ? extractPaperId(browserTab.url) : null;
    const loadedPaperId = tabState[tab].paperData?.url ? extractPaperId(tabState[tab].paperData.url) : null;

    // 로딩 중이 아니고, 현재 페이지와 로드된 논문이 다르면 히스토리에서 찾기
    if (!tabState[tab].isLoading && currentPaperId && currentPaperId !== loadedPaperId) {
      // 히스토리 검색 중 표시
      document.getElementById('status').textContent = '🔍 히스토리 확인 중...';

      const historyItem = await loadHistoryForCurrentPage(tab);
      if (historyItem) {
        tabState[tab].markdown = historyItem.markdown;
        tabState[tab].usage = historyItem.usage;
        tabState[tab].model = historyItem.model;
        tabState[tab].paperData = { title: historyItem.title, url: historyItem.url };
      } else {
        // 히스토리에 없으면 상태 초기화
        tabState[tab].markdown = '';
        tabState[tab].usage = null;
        tabState[tab].model = null;
        tabState[tab].paperData = null;
      }
    }

    displayTabResult(tab);

    // 상태 메시지 업데이트
    if (tabState[tab].isLoading) {
      document.getElementById('status').textContent = tab === 'abstract' ? '⏳ 초록 요약 중...' : '⏳ 전문 분석 중...';
    } else if (tabState[tab].markdown) {
      document.getElementById('status').textContent = tab === 'abstract' ? '📝 초록 요약' : '📚 전문 분석';
    } else {
      document.getElementById('status').textContent = '▶️ 버튼을 눌러 분석을 시작하세요';
    }
  } finally {
    // 약간의 딜레이 후 플래그 해제 (연속 클릭 방지)
    setTimeout(() => { isTabSwitching = false; }, 100);
  }
}

// 분석 시작
function handleStartAnalysis() {
  // 현재 탭이 로딩 중이면 무시
  if (tabState[currentTab].isLoading) return;

  if (currentTab === 'abstract') {
    runAbstractAnalysis();
  } else {
    runFullAnalysis();
  }
}

// 탭 버튼 이벤트
document.getElementById('tabAbstract').addEventListener('click', () => handleTabClick('abstract'));
document.getElementById('tabFull').addEventListener('click', () => handleTabClick('full'));
document.getElementById('startBtn').addEventListener('click', handleStartAnalysis);

// 마크다운 복사 버튼
document.getElementById('copyBtn').addEventListener('click', async () => {
  const copyBtn = document.getElementById('copyBtn');
  try {
    await navigator.clipboard.writeText(getCurrentMarkdown());
    copyBtn.textContent = '✅ 복사됨!';
    setTimeout(() => { copyBtn.textContent = '📋 복사'; }, 2000);
  } catch (e) {
    copyBtn.textContent = '❌ 실패';
  }
});

// Notion 저장 버튼 (푸터)
document.getElementById('notionSaveBtn').addEventListener('click', async () => {
  const btn = document.getElementById('notionSaveBtn');
  const state = tabState[currentTab];
  if (!state.markdown || !state.paperData) return;

  btn.disabled = true;
  btn.textContent = '⏳ 저장 중...';

  try {
    const item = {
      title: state.paperData.title,
      url: state.paperData.url,
      markdown: state.markdown,
      usage: state.usage,
      model: state.model,
      tab: currentTab,
      provider: currentSettings.provider,
      timestamp: Date.now()
    };
    await saveToNotion(item);
    btn.textContent = '✅ 저장됨!';
    showToast('📓 Notion에 저장되었습니다!', 'success');
    setTimeout(() => { btn.textContent = '📓 Notion'; btn.disabled = false; }, 2000);
  } catch (err) {
    btn.textContent = '📓 Notion';
    btn.disabled = false;
    showToast('Notion 저장 실패: ' + err.message, 'error');
  }
});

// 논문 보기 버튼
document.getElementById('viewPaperBtn').addEventListener('click', () => {
  const url = getPaperUrl();
  if (url) {
    chrome.tabs.create({ url });
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

// 히스토리 탭 필터
document.querySelectorAll('.history-tab').forEach(tab => {
  tab.addEventListener('click', () => handleHistoryTabClick(tab.dataset.filter));
});

// JSON 내보내기
document.getElementById('exportHistoryBtn').addEventListener('click', async () => {
  const history = await loadHistory();
  if (history.length === 0) {
    alert('내보낼 히스토리가 없습니다.');
    return;
  }

  const exportData = {
    version: 1,
    exportedAt: new Date().toISOString(),
    count: history.length,
    items: history
  };

  const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const date = new Date().toISOString().slice(0, 10);

  const a = document.createElement('a');
  a.href = url;
  a.download = `arxiv-summarizer-history-${date}.json`;
  a.click();
  URL.revokeObjectURL(url);
});

// JSON 가져오기
document.getElementById('importHistoryBtn').addEventListener('click', () => {
  document.getElementById('importFileInput').click();
});

document.getElementById('importFileInput').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  try {
    const text = await file.text();
    const importData = JSON.parse(text);

    // 검증
    if (!importData.version || !Array.isArray(importData.items)) {
      throw new Error('올바른 내보내기 파일이 아닙니다.');
    }

    for (const item of importData.items) {
      if (!item.title || !item.url || !item.markdown) {
        throw new Error('필수 필드가 누락된 항목이 있습니다.');
      }
    }

    // 기존 히스토리와 병합
    const existing = await loadHistory();
    const merged = [...existing];

    for (const importItem of importData.items) {
      const importPaperId = extractPaperId(importItem.url);
      const importTab = importItem.tab || 'abstract';
      const existingIdx = merged.findIndex(h => {
        const hPaperId = extractPaperId(h.url);
        return hPaperId === importPaperId && (h.tab || 'abstract') === importTab;
      });

      if (existingIdx >= 0) {
        // 같은 논문+탭: 최신 것 유지
        if ((importItem.timestamp || 0) > (merged[existingIdx].timestamp || 0)) {
          merged[existingIdx] = importItem;
        }
      } else {
        merged.push(importItem);
      }
    }

    // 최신순 정렬
    merged.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

    // 50개/4MB 제한 적용
    const MAX_ITEMS = 50;
    const MAX_STORAGE_BYTES = 4 * 1024 * 1024;
    while (merged.length > MAX_ITEMS) merged.pop();
    while (merged.length > 1) {
      const size = new Blob([JSON.stringify(merged)]).size;
      if (size <= MAX_STORAGE_BYTES) break;
      merged.pop();
    }

    await chrome.storage.local.set({ history: merged });
    renderHistoryModal();
    alert(`가져오기 완료! (${importData.items.length}개 중 ${merged.length}개 저장됨)`);
  } catch (err) {
    alert('가져오기 실패: ' + err.message);
  }

  // 파일 입력 초기화
  e.target.value = '';
});

// 전체 히스토리 삭제
document.getElementById('clearHistory').addEventListener('click', async () => {
  if (confirm('모든 히스토리를 삭제하시겠습니까?')) {
    // 히스토리와 lastResult 모두 삭제
    await chrome.storage.local.remove(['history', 'lastResult']);

    // 현재 탭 상태도 초기화
    tabState.abstract = { markdown: '', usage: null, model: null, paperData: null, isLoading: false };
    tabState.full = { markdown: '', usage: null, model: null, paperData: null, isLoading: false };

    // UI 업데이트
    displayTabResult(currentTab);
    document.getElementById('status').textContent = '🗑️ 히스토리 삭제됨';

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
    handleContextMenuSummarize();
  }
});

// 컨텍스트 메뉴 요약 처리
async function handleContextMenuSummarize() {
  currentTab = 'abstract';
  updateTabUI();

  // 히스토리에서 현재 논문 찾기
  const historyItem = await loadHistoryForCurrentPage('abstract');
  if (historyItem) {
    // 히스토리에 있으면 불러오기
    tabState.abstract.markdown = historyItem.markdown;
    tabState.abstract.usage = historyItem.usage;
    tabState.abstract.model = historyItem.model;
    tabState.abstract.paperData = { title: historyItem.title, url: historyItem.url };
    displayTabResult('abstract');
    document.getElementById('status').textContent = '📝 저장된 초록 요약';
  } else {
    // 없으면 새로 분석
    runAbstractAnalysis();
  }
}

// ==========================================
// Notion 연동
// ==========================================

// Notion 설정 로드
async function loadNotionSettings() {
  const local = await chrome.storage.local.get(['notionToken']);
  const sync = await chrome.storage.sync.get(['notionPageId']);
  return {
    token: local.notionToken || '',
    pageId: sync.notionPageId || '312ee7ef-42c9-8078-bc7b-e357ec4fa11a'
  };
}

// Notion DB ID 로드/저장
async function getNotionDbId() {
  const { notionDbId } = await chrome.storage.local.get('notionDbId');
  return notionDbId || null;
}

async function setNotionDbId(dbId) {
  await chrome.storage.local.set({ notionDbId: dbId });
}

// Notion 매핑 로드/저장
async function getNotionMapping() {
  const { notionMapping } = await chrome.storage.local.get('notionMapping');
  return notionMapping || {};
}

async function updateNotionMapping(paperId, data) {
  const mapping = await getNotionMapping();
  mapping[paperId] = { ...(mapping[paperId] || {}), ...data };
  await chrome.storage.local.set({ notionMapping: mapping });
}

// 인라인 마크다운 → Notion rich_text 배열 파싱
function parseInlineMarkdown(text) {
  const richText = [];
  // 패턴: **bold**, __bold__, *italic*, _italic_, `code`, [text](url)
  const regex = /(\*\*(.+?)\*\*|__(.+?)__|`(.+?)`|\*(.+?)\*|_(.+?)_|\[([^\]]+)\]\(([^)]+)\))/g;
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(text)) !== null) {
    // 매치 이전의 일반 텍스트
    if (match.index > lastIndex) {
      const plain = text.slice(lastIndex, match.index);
      if (plain) {
        richText.push({ type: 'text', text: { content: plain }, annotations: {} });
      }
    }

    if (match[2] || match[3]) {
      // **bold** or __bold__
      const content = match[2] || match[3];
      richText.push({ type: 'text', text: { content }, annotations: { bold: true } });
    } else if (match[4]) {
      // `code`
      richText.push({ type: 'text', text: { content: match[4] }, annotations: { code: true } });
    } else if (match[5] || match[6]) {
      // *italic* or _italic_
      const content = match[5] || match[6];
      richText.push({ type: 'text', text: { content }, annotations: { italic: true } });
    } else if (match[7] && match[8]) {
      // [text](url)
      richText.push({ type: 'text', text: { content: match[7], link: { url: match[8] } }, annotations: {} });
    }

    lastIndex = regex.lastIndex;
  }

  // 남은 텍스트
  if (lastIndex < text.length) {
    const remaining = text.slice(lastIndex);
    if (remaining) {
      richText.push({ type: 'text', text: { content: remaining }, annotations: {} });
    }
  }

  // 빈 배열이면 원본 텍스트 그대로
  if (richText.length === 0) {
    richText.push({ type: 'text', text: { content: text }, annotations: {} });
  }

  // 각 항목의 content를 2000자로 제한
  return richText.map(item => {
    if (item.text.content.length > 2000) {
      item.text.content = item.text.content.slice(0, 2000);
    }
    return item;
  });
}

// 마크다운 → Notion 블록 변환
function markdownToNotionBlocks(markdown) {
  const lines = markdown.split('\n');
  const blocks = [];
  let i = 0;

  while (i < lines.length && blocks.length < 100) {
    const line = lines[i];

    // 빈 줄 스킵
    if (line.trim() === '') { i++; continue; }

    // 수평선 (---, ***, ___)
    if (/^[-*_]{3,}\s*$/.test(line.trim())) {
      blocks.push({ object: 'block', type: 'divider', divider: {} });
      i++; continue;
    }

    // 마크다운 테이블
    if (line.trim().startsWith('|') && line.trim().endsWith('|')) {
      const tableRows = [];
      while (i < lines.length && lines[i].trim().startsWith('|') && lines[i].trim().endsWith('|')) {
        const row = lines[i].trim();
        // 구분선(|---|---|) 스킵
        if (!/^\|[\s\-:|]+\|$/.test(row)) {
          const cells = row.slice(1, -1).split('|').map(c => c.trim());
          tableRows.push(cells);
        }
        i++;
      }
      if (tableRows.length > 0) {
        const colCount = Math.max(...tableRows.map(r => r.length));
        const children = tableRows.map(cells => ({
          object: 'block', type: 'table_row',
          table_row: {
            cells: Array.from({ length: colCount }, (_, ci) => {
              const cellText = (cells[ci] || '').trim();
              return cellText ? parseInlineMarkdown(cellText) : [{ type: 'text', text: { content: '' } }];
            })
          }
        }));
        blocks.push({
          object: 'block', type: 'table',
          table: {
            table_width: colCount,
            has_column_header: true,
            has_row_header: false,
            children
          }
        });
      }
      continue;
    }

    // 펜스드 코드블럭 (``` ... ```)
    if (line.trim().startsWith('```')) {
      const lang = line.trim().slice(3).trim();
      const codeLines = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      if (i < lines.length) i++; // 닫는 ``` 스킵
      blocks.push({
        object: 'block', type: 'code',
        code: {
          rich_text: [{ type: 'text', text: { content: truncateText(codeLines.join('\n'), 2000) } }],
          language: lang || 'plain text'
        }
      });
      continue;
    }

    // 헤딩 (#### → heading_3 폴백, Notion에 heading_4 없음)
    if (line.startsWith('#### ')) {
      blocks.push({
        object: 'block', type: 'heading_3',
        heading_3: { rich_text: parseInlineMarkdown(line.slice(5).trim()) }
      });
      i++; continue;
    }
    if (line.startsWith('### ')) {
      blocks.push({
        object: 'block', type: 'heading_3',
        heading_3: { rich_text: parseInlineMarkdown(line.slice(4).trim()) }
      });
      i++; continue;
    }
    if (line.startsWith('## ')) {
      blocks.push({
        object: 'block', type: 'heading_2',
        heading_2: { rich_text: parseInlineMarkdown(line.slice(3).trim()) }
      });
      i++; continue;
    }
    if (line.startsWith('# ')) {
      blocks.push({
        object: 'block', type: 'heading_1',
        heading_1: { rich_text: parseInlineMarkdown(line.slice(2).trim()) }
      });
      i++; continue;
    }

    // 인용문 (blockquote)
    if (line.startsWith('> ')) {
      blocks.push({
        object: 'block', type: 'quote',
        quote: { rich_text: parseInlineMarkdown(line.slice(2).trim()) }
      });
      i++; continue;
    }

    // 번호 리스트
    if (/^\d+\.\s/.test(line)) {
      const content = line.replace(/^\d+\.\s/, '').trim();
      blocks.push({
        object: 'block', type: 'numbered_list_item',
        numbered_list_item: { rich_text: parseInlineMarkdown(content) }
      });
      i++; continue;
    }

    // 불릿 리스트
    if (line.startsWith('- ') || line.startsWith('* ')) {
      const content = line.slice(2).trim();
      blocks.push({
        object: 'block', type: 'bulleted_list_item',
        bulleted_list_item: { rich_text: parseInlineMarkdown(content) }
      });
      i++; continue;
    }

    // 일반 문단
    blocks.push({
      object: 'block', type: 'paragraph',
      paragraph: { rich_text: parseInlineMarkdown(line.trim()) }
    });
    i++;
  }

  return blocks;
}

function truncateText(text, max) {
  return text.length > max ? text.slice(0, max) : text;
}

// 키워드 추출 (마크다운에서 "핵심 키워드" 섹션 파싱)
function extractKeywords(markdown) {
  const match = markdown.match(/핵심\s*키워드[^\n]*\n([\s\S]*?)(?:\n#|\n---|\n\n\n|$)/i);
  if (!match) return [];

  const section = match[1];
  const keywords = [];
  const lines = section.split('\n');
  for (const line of lines) {
    if (!line.trim()) continue;

    // 1) 백틱으로 감싼 키워드 직접 추출: `keyword1` `keyword2`
    const backtickMatches = line.match(/`([^`]+)`/g);
    if (backtickMatches && backtickMatches.length > 0) {
      for (const m of backtickMatches) {
        const kw = m.replace(/`/g, '').trim();
        if (kw && kw.length < 50) keywords.push(kw);
      }
      if (keywords.length >= 10) break;
      continue;
    }

    // 2) **키워드** 패턴 직접 추출: **keyword1** **keyword2**
    const boldMatches = line.match(/\*\*([^*]+)\*\*/g);
    if (boldMatches && boldMatches.length > 1) {
      for (const m of boldMatches) {
        const kw = m.replace(/\*\*/g, '').trim();
        if (kw && kw.length < 50) keywords.push(kw);
      }
      if (keywords.length >= 10) break;
      continue;
    }

    // 3) 일반 텍스트: 구분자로 분리
    let cleaned = line.replace(/^[-*\d.]\s*/, '').replace(/[`*#]/g, '').trim();
    if (!cleaned) continue;
    const parts = cleaned.split(/[,，、·|\/]|\s{2,}/);
    for (const part of parts) {
      const kw = part.trim();
      if (kw && kw.length > 0 && kw.length < 50) keywords.push(kw);
    }
    if (keywords.length >= 10) break;
  }
  return keywords.slice(0, 10);
}

// Notion DB 생성 (최초 1회)
async function ensureNotionDatabase(token, parentPageId) {
  let dbId = await getNotionDbId();
  if (dbId) return dbId;

  const response = await chrome.runtime.sendMessage({
    action: 'notionCreateDatabase',
    token,
    body: {
      parent: { type: 'page_id', page_id: parentPageId },
      title: [{ type: 'text', text: { content: 'arXiv 논문 요약' } }],
      icon: { type: 'emoji', emoji: '📊' },
      properties: {
        'Title': { title: {} },
        'URL': { url: {} },
        'Date': { date: {} },
        'Keywords': { multi_select: {} },
        'Provider': { select: { options: [
          { name: 'CLAUDE', color: 'orange' },
          { name: 'OPENAI', color: 'green' },
          { name: 'N8N', color: 'blue' },
          { name: 'ATLAS', color: 'purple' }
        ]}},
        'Model': { rich_text: {} },
        '전문분석': { checkbox: {} }
      }
    }
  });

  if (!response.success) throw new Error(response.error);
  dbId = response.data.id;
  await setNotionDbId(dbId);
  return dbId;
}

// Notion에 초록 DB 항목 생성
async function createNotionAbstractEntry(token, dbId, item) {
  const keywords = extractKeywords(item.markdown);
  const blocks = markdownToNotionBlocks(item.markdown);

  const properties = {
    'Title': { title: [{ text: { content: truncateText(item.title, 2000) } }] },
    'URL': { url: item.url },
    'Date': { date: { start: new Date(item.timestamp || Date.now()).toISOString().slice(0, 10) } },
    'Provider': { select: { name: (item.provider || 'n8n').toUpperCase() } },
    '전문분석': { checkbox: false }
  };

  if (item.model) {
    properties['Model'] = { rich_text: [{ text: { content: item.model } }] };
  }

  if (keywords.length > 0) {
    properties['Keywords'] = { multi_select: keywords.map(k => ({ name: k })) };
  }

  const response = await chrome.runtime.sendMessage({
    action: 'notionCreatePage',
    token,
    body: {
      parent: { database_id: dbId },
      properties,
      children: blocks
    }
  });

  if (!response.success) throw new Error(response.error);
  return response.data.id;
}

// Notion에 전문 하위 페이지 생성
async function createNotionFullPage(token, parentPageId, item) {
  const keywords = extractKeywords(item.markdown);
  const date = new Date(item.timestamp || Date.now()).toISOString().slice(0, 10);

  // 메타데이터 블록 (본문 최상단)
  const metaLines = [];
  if (item.provider) metaLines.push(`Provider: ${item.provider.toUpperCase()}`);
  if (item.model) metaLines.push(`Model: ${item.model}`);
  metaLines.push(`Date: ${date}`);
  if (keywords.length > 0) metaLines.push(`Keywords: ${keywords.join(', ')}`);

  const metaBlock = {
    object: 'block', type: 'callout',
    callout: {
      icon: { type: 'emoji', emoji: '📋' },
      rich_text: [{ type: 'text', text: { content: metaLines.join('\n') } }],
      color: 'gray_background'
    }
  };

  const blocks = [metaBlock, { object: 'block', type: 'divider', divider: {} }, ...markdownToNotionBlocks(item.markdown)];

  const response = await chrome.runtime.sendMessage({
    action: 'notionCreatePage',
    token,
    body: {
      parent: { page_id: parentPageId },
      icon: { type: 'emoji', emoji: '📄' },
      properties: {
        title: { title: [{ text: { content: '전문 분석' } }] }
      },
      children: blocks
    }
  });

  if (!response.success) throw new Error(response.error);
  return response.data.id;
}

// Notion 블록 추가 (페이지에 블록 append)
async function notionAppendBlocks(token, blockId, blocks) {
  const response = await chrome.runtime.sendMessage({
    action: 'notionAppendBlocks',
    token,
    blockId,
    body: { children: blocks }
  });
  if (!response.success) throw new Error(response.error);
  return response.data;
}

// 전문분석 체크박스 업데이트
async function updateNotionFullCheckbox(token, pageId) {
  const response = await chrome.runtime.sendMessage({
    action: 'notionUpdatePage',
    token,
    pageId,
    body: {
      properties: { '전문분석': { checkbox: true } }
    }
  });
  if (!response.success) throw new Error(response.error);
}

// Notion 저장 메인 로직
async function saveToNotion(item) {
  const { token, pageId } = await loadNotionSettings();
  if (!token) throw new Error('Notion Integration Token이 설정되지 않았습니다. 설정 페이지에서 입력해주세요.');

  const dbId = await ensureNotionDatabase(token, pageId);
  const paperId = extractPaperId(item.url);
  if (!paperId) throw new Error('논문 ID를 추출할 수 없습니다.');

  const mapping = await getNotionMapping();
  const itemTab = item.tab || 'abstract';

  if (itemTab === 'abstract') {
    // 초록 저장 (이전 매핑이 있으면 새로 덮어쓰기)
    const notionPageId = await createNotionAbstractEntry(token, dbId, item);
    await updateNotionMapping(paperId, { pageId: notionPageId, fullPageId: null });

  } else {
    // 전문 저장
    let abstractPageId = mapping[paperId]?.pageId;

    // 기존 매핑의 페이지가 실제로 존재하는지 확인
    if (abstractPageId) {
      try {
        await chrome.runtime.sendMessage({
          action: 'notionGetPage', token, pageId: abstractPageId
        });
      } catch {
        // 페이지가 삭제된 경우 매핑 초기화
        abstractPageId = null;
      }
    }

    if (!abstractPageId) {
      // 초록이 아직 Notion에 없음 → 로컬 히스토리에서 초록 찾아서 같이 저장
      const history = await loadHistory();
      const abstractItem = history.find(h => {
        const hPaperId = extractPaperId(h.url);
        return hPaperId === paperId && (h.tab || 'abstract') === 'abstract';
      });

      if (abstractItem) {
        abstractPageId = await createNotionAbstractEntry(token, dbId, abstractItem);
      } else {
        const minimalItem = {
          title: item.title,
          url: item.url,
          markdown: `# ${item.title}\n\n(초록 요약 없음 - 전문 분석만 저장됨)`,
          provider: item.provider || 'n8n',
          model: item.model,
          timestamp: item.timestamp
        };
        abstractPageId = await createNotionAbstractEntry(token, dbId, minimalItem);
      }
      await updateNotionMapping(paperId, { pageId: abstractPageId });
    }

    // 구분선 + 콜아웃을 먼저 추가 (전문 하위페이지 링크보다 위에 오도록)
    await notionAppendBlocks(token, abstractPageId, [
      { object: 'block', type: 'divider', divider: {} },
      {
        object: 'block',
        type: 'callout',
        callout: {
          icon: { type: 'emoji', emoji: '📄' },
          rich_text: [{ type: 'text', text: { content: '📚 전문 분석이 하위 페이지에 포함되어 있습니다.' } }],
          color: 'blue_background'
        }
      }
    ]);

    // 전문 하위 페이지 생성 (하위 페이지 링크가 callout 아래에 위치)
    const fullPageId = await createNotionFullPage(token, abstractPageId, item);
    await updateNotionMapping(paperId, { fullPageId });
    await updateNotionFullCheckbox(token, abstractPageId);
  }
}

// 초기화
document.addEventListener('DOMContentLoaded', async () => {
  await loadSettings();
  await restoreLastResult();
});
