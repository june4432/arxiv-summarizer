// 기본 프롬프트 템플릿
const DEFAULT_PROMPT = `다음 논문을 {{language}}로 요약해주세요.

## 논문 정보
- 제목: {{title}}
- URL: {{url}}

## 초록
{{abstract}}

## 요청사항
1. 논문의 핵심 기여(contribution)를 3줄 이내로 요약
2. 사용된 방법론 간단히 설명
3. 주요 결과 및 성능
4. 한계점 또는 향후 연구 방향 (있다면)

마크다운 형식으로 깔끔하게 정리해주세요.`;

// 기본 설정값
const DEFAULT_SETTINGS = {
  darkMode: false,
  provider: 'n8n',
  n8nWebhookUrl: 'http://localhost:5678/webhook/12aba2b1-9817-4ba2-9d14-a4141f69a557',
  claudeModel: 'claude-sonnet-4-20250514',
  openaiModel: 'gpt-4o',
  summaryLanguage: 'korean',
  userPrompt: DEFAULT_PROMPT
};

// DOM 요소들
const elements = {
  darkMode: document.getElementById('darkMode'),
  provider: document.getElementById('provider'),
  n8nWebhookUrl: document.getElementById('n8nWebhookUrl'),
  claudeApiKey: document.getElementById('claudeApiKey'),
  claudeModel: document.getElementById('claudeModel'),
  openaiApiKey: document.getElementById('openaiApiKey'),
  openaiModel: document.getElementById('openaiModel'),
  summaryLanguage: document.getElementById('summaryLanguage'),
  userPrompt: document.getElementById('userPrompt'),
  saveBtn: document.getElementById('saveBtn'),
  resetPrompt: document.getElementById('resetPrompt'),
  status: document.getElementById('status'),
  n8nSettings: document.getElementById('n8nSettings'),
  claudeSettings: document.getElementById('claudeSettings'),
  openaiSettings: document.getElementById('openaiSettings'),
  promptSection: document.getElementById('promptSection')
};

// 테마 적용
function applyTheme(isDark) {
  document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
}

// 프로바이더에 따른 UI 표시/숨김
function updateProviderUI(provider) {
  elements.n8nSettings.classList.remove('active');
  elements.claudeSettings.classList.remove('active');
  elements.openaiSettings.classList.remove('active');

  switch (provider) {
    case 'n8n':
      elements.n8nSettings.classList.add('active');
      elements.promptSection.style.display = 'none';
      break;
    case 'claude':
      elements.claudeSettings.classList.add('active');
      elements.promptSection.style.display = 'block';
      break;
    case 'openai':
      elements.openaiSettings.classList.add('active');
      elements.promptSection.style.display = 'block';
      break;
  }
}

// 설정 불러오기
async function loadSettings() {
  try {
    // sync 스토리지에서 일반 설정 불러오기
    const syncData = await chrome.storage.sync.get([
      'darkMode',
      'provider',
      'n8nWebhookUrl',
      'claudeModel',
      'openaiModel',
      'summaryLanguage',
      'userPrompt'
    ]);

    // local 스토리지에서 API 키 불러오기
    const localData = await chrome.storage.local.get([
      'claudeApiKey',
      'openaiApiKey'
    ]);

    // 설정값 적용 (없으면 기본값 사용)
    elements.darkMode.checked = syncData.darkMode ?? DEFAULT_SETTINGS.darkMode;
    elements.provider.value = syncData.provider ?? DEFAULT_SETTINGS.provider;
    elements.n8nWebhookUrl.value = syncData.n8nWebhookUrl ?? DEFAULT_SETTINGS.n8nWebhookUrl;
    elements.claudeModel.value = syncData.claudeModel ?? DEFAULT_SETTINGS.claudeModel;
    elements.openaiModel.value = syncData.openaiModel ?? DEFAULT_SETTINGS.openaiModel;
    elements.summaryLanguage.value = syncData.summaryLanguage ?? DEFAULT_SETTINGS.summaryLanguage;
    elements.userPrompt.value = syncData.userPrompt ?? DEFAULT_SETTINGS.userPrompt;

    elements.claudeApiKey.value = localData.claudeApiKey ?? '';
    elements.openaiApiKey.value = localData.openaiApiKey ?? '';

    // 테마 적용
    applyTheme(elements.darkMode.checked);

    // 프로바이더 UI 업데이트
    updateProviderUI(elements.provider.value);

  } catch (e) {
    console.error('설정 불러오기 실패:', e);
  }
}

// 설정 저장
async function saveSettings() {
  try {
    // sync 스토리지에 일반 설정 저장
    await chrome.storage.sync.set({
      darkMode: elements.darkMode.checked,
      provider: elements.provider.value,
      n8nWebhookUrl: elements.n8nWebhookUrl.value,
      claudeModel: elements.claudeModel.value,
      openaiModel: elements.openaiModel.value,
      summaryLanguage: elements.summaryLanguage.value,
      userPrompt: elements.userPrompt.value
    });

    // local 스토리지에 API 키 저장
    await chrome.storage.local.set({
      claudeApiKey: elements.claudeApiKey.value,
      openaiApiKey: elements.openaiApiKey.value
    });

    showStatus('✅ 설정이 저장되었습니다!', 'success');
  } catch (e) {
    console.error('설정 저장 실패:', e);
    showStatus('❌ 설정 저장 실패: ' + e.message, 'error');
  }
}

// 상태 메시지 표시
function showStatus(message, type) {
  elements.status.textContent = message;
  elements.status.className = 'status ' + type;

  setTimeout(() => {
    elements.status.className = 'status';
  }, 3000);
}

// API 키 표시/숨김 토글
function setupApiKeyToggles() {
  document.querySelectorAll('.api-key-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      const targetId = btn.dataset.target;
      const input = document.getElementById(targetId);

      if (input.type === 'password') {
        input.type = 'text';
        btn.textContent = '🙈';
      } else {
        input.type = 'password';
        btn.textContent = '👁️';
      }
    });
  });
}

// 이벤트 리스너 설정
function setupEventListeners() {
  // 다크모드 토글
  elements.darkMode.addEventListener('change', (e) => {
    applyTheme(e.target.checked);
  });

  // 프로바이더 변경
  elements.provider.addEventListener('change', (e) => {
    updateProviderUI(e.target.value);
  });

  // 저장 버튼
  elements.saveBtn.addEventListener('click', saveSettings);

  // 프롬프트 초기화
  elements.resetPrompt.addEventListener('click', () => {
    elements.userPrompt.value = DEFAULT_PROMPT;
    showStatus('프롬프트가 초기화되었습니다.', 'success');
  });

  // API 키 토글
  setupApiKeyToggles();
}

// 초기화
document.addEventListener('DOMContentLoaded', async () => {
  await loadSettings();
  setupEventListeners();
});
