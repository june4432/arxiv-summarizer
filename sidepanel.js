let currentSettings = {};
let currentTab = 'abstract';

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
      const lastTab = localData.lastResult.tab || 'abstract';
      tabState[lastTab].markdown = localData.lastResult.markdown || '';
      tabState[lastTab].usage = localData.lastResult.usage || null;
      tabState[lastTab].model = localData.lastResult.model || null;
      tabState[lastTab].paperData = localData.lastResult.paperData || null;

      if (tabState[lastTab].markdown) {
        currentTab = lastTab;
        updateTabUI();
        displayTabResult(lastTab);
        document.getElementById('status').textContent = '📝 이전 결과';
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

// 탭 UI 업데이트
function updateTabUI() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    const tab = btn.dataset.tab;
    btn.classList.toggle('active', tab === currentTab);
    btn.classList.toggle('loading', tabState[tab].isLoading);
  });
  // 현재 탭이 로딩 중이면 새로고침 버튼 비활성화
  document.getElementById('refreshBtn').disabled = tabState[currentTab].isLoading;
}

// 탭 결과 표시 (로딩 상태 포함)
function displayTabResult(tab) {
  const state = tabState[tab];
  const resultDiv = document.getElementById('result');
  const copyBtn = document.getElementById('copyBtn');
  const status = document.getElementById('status');

  if (state.markdown) {
    resultDiv.innerHTML = marked.parse(state.markdown);
    addCodeCopyButtons();
    resultDiv.style.display = 'block';
    copyBtn.disabled = false;
    if (state.usage && state.model) {
      displayTokenInfo(state.usage, state.model);
    } else {
      document.getElementById('tokenInfo').style.display = 'none';
    }
  } else {
    resultDiv.style.display = 'none';
    resultDiv.innerHTML = '';
    copyBtn.disabled = true;
    document.getElementById('tokenInfo').style.display = 'none';
  }

  // 로딩 상태 표시
  if (state.isLoading) {
    status.textContent = tab === 'abstract' ? '⏳ 초록 요약 중...' : '⏳ 전문 분석 중...';
  }
}

// 현재 탭의 마크다운 가져오기
function getCurrentMarkdown() {
  return tabState[currentTab].markdown;
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
      max_tokens: 8192,
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
          const parsed = JSON.parse(jsonStr);

          if (parsed.type === 'content_block_delta' && parsed.delta?.text) {
            fullText += parsed.delta.text;
            onChunk(fullText);
          }

          if (parsed.type === 'message_delta' && parsed.usage) {
            usage.output_tokens = parsed.usage.output_tokens;
          }

          if (parsed.type === 'message_start' && parsed.message?.usage) {
            usage.input_tokens = parsed.message.usage.input_tokens;
          }
        } catch (e) {}
      }
    }
  }

  return { text: fullText, usage };
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

  historyList.innerHTML = history.map(item => {
    const tabLabel = item.tab === 'full' ? '📚 전문' : '📝 초록';
    return `
    <div class="history-item" data-id="${item.id}">
      <div class="history-item-title">${item.title}</div>
      <div class="history-item-meta">
        <span class="history-tab-badge ${item.tab || 'abstract'}">${tabLabel}</span>
        <span>${item.provider.toUpperCase()}</span>
        <span>${new Date(item.timestamp).toLocaleDateString('ko-KR')}</span>
      </div>
      <div class="history-item-actions">
        <button class="load-btn" data-id="${item.id}">불러오기</button>
        <button class="btn-danger delete-btn" data-id="${item.id}">삭제</button>
      </div>
    </div>
  `}).join('');

  // 이벤트 리스너 추가
  historyList.querySelectorAll('.load-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = parseInt(btn.dataset.id);
      const item = history.find(h => h.id === id);
      if (item) {
        const tab = item.tab || 'abstract';
        tabState[tab].markdown = item.markdown;
        tabState[tab].usage = item.usage;
        tabState[tab].model = item.model;
        tabState[tab].paperData = { title: item.title, url: item.url };
        currentTab = tab;
        updateTabUI();
        displayTabResult(tab);
        document.getElementById('status').textContent = '📝 히스토리에서 불러옴';
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
    status.textContent = '⏳ 파싱 중...';
    result.style.display = 'none';
    copyBtn.disabled = true;
    tokenInfo.style.display = 'none';
  }

  const [browserTab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (!browserTab.url.includes('arxiv.org')) {
    if (currentTab === TAB) status.textContent = '❌ arXiv 페이지에서 실행해주세요.';
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
    if (currentTab === TAB) status.textContent = '❌ 논문 정보를 찾을 수 없습니다.';
    tabState[TAB].isLoading = false;
    updateTabUI();
    return;
  }

  const providerLabels = { n8n: 'n8n', claude: 'Claude', openai: 'OpenAI' };
  if (currentTab === TAB) {
    status.textContent = `⏳ ${providerLabels[currentSettings.provider]} 요청 중...`;
  }

  try {
    let response;
    let model;

    const onChunk = (text) => {
      tabState[TAB].markdown = text;
      // 현재 탭이 abstract일 때만 UI 업데이트
      if (currentTab === TAB) {
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
      case 'n8n':
      default:
        model = null;
        response = await callN8n(data);
        tabState[TAB].markdown = response.text;
        if (currentTab === TAB) {
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
    if (currentTab === TAB) status.textContent = '❌ 요청 실패: ' + e.message;
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
    if (currentTab === TAB) status.textContent = '❌ 전문 분석은 Claude 또는 OpenAI에서만 사용 가능합니다.';
    return;
  }

  // 로딩 상태 설정
  tabState[TAB].isLoading = true;
  updateTabUI();

  // 현재 탭이면 UI 초기화
  if (currentTab === TAB) {
    status.textContent = '⏳ 논문 HTML 가져오는 중...';
    result.style.display = 'none';
    copyBtn.disabled = true;
    tokenInfo.style.display = 'none';
  }

  const [browserTab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (!browserTab.url.includes('arxiv.org')) {
    if (currentTab === TAB) status.textContent = '❌ arXiv 페이지에서 실행해주세요.';
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
      if (currentTab === TAB) status.textContent = '❌ 논문 정보를 찾을 수 없습니다.';
      tabState[TAB].isLoading = false;
      updateTabUI();
      return;
    }

    // HTML에서 전문 가져오기
    if (currentTab === TAB) status.textContent = '⏳ 논문 전문 파싱 중...';
    const fullText = await fetchArxivFullText(basicData.url);

    const data = {
      title: basicData.title,
      url: basicData.url,
      fullText
    };

    const charCount = fullText.length.toLocaleString();
    const providerLabels = { claude: 'Claude', openai: 'OpenAI' };
    if (currentTab === TAB) {
      status.textContent = `⏳ ${providerLabels[currentSettings.provider]} 전문 분석 중... (${charCount}자)`;
    }

    let response;
    let model;

    const onChunk = (text) => {
      tabState[TAB].markdown = text;
      // 현재 탭이 full일 때만 UI 업데이트
      if (currentTab === TAB) {
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
    if (currentTab === TAB) status.textContent = '❌ 오류: ' + e.message;
  } finally {
    tabState[TAB].isLoading = false;
    updateTabUI();
  }
}

// 탭 클릭 핸들러
function handleTabClick(tab) {
  if (currentTab === tab) return; // 같은 탭 클릭 무시

  currentTab = tab;
  updateTabUI();
  displayTabResult(tab);

  // 결과가 없고 로딩 중이 아니면 분석 실행
  if (!tabState[tab].markdown && !tabState[tab].isLoading) {
    if (tab === 'abstract') {
      runAbstractAnalysis();
    } else {
      runFullAnalysis();
    }
  } else if (tabState[tab].markdown) {
    document.getElementById('status').textContent = tab === 'abstract' ? '📝 초록 요약' : '📚 전문 분석';
  }
}

// 새로고침 (강제 재분석)
function handleRefresh() {
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
document.getElementById('refreshBtn').addEventListener('click', handleRefresh);

// 마크다운 복사 버튼
document.getElementById('copyBtn').addEventListener('click', async () => {
  const copyBtn = document.getElementById('copyBtn');
  try {
    await navigator.clipboard.writeText(getCurrentMarkdown());
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
    // 초록 요약 탭으로 전환하고 분석 실행
    currentTab = 'abstract';
    updateTabUI();
    runAbstractAnalysis();
  }
});

// 초기화
document.addEventListener('DOMContentLoaded', loadSettings);
