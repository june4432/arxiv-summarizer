// 툴바 아이콘 클릭 시 사이드패널 열기
chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ tabId: tab.id });
});

// 컨텍스트 메뉴 생성
chrome.runtime.onInstalled.addListener(() => {
  // 1. 페이지에서 "이 논문 요약하기" (텍스트, 이미지 등 어디서든)
  chrome.contextMenus.create({
    id: 'summarize-page',
    title: '📄 이 논문 요약하기',
    contexts: ['page', 'selection', 'image', 'frame'],
    documentUrlPatterns: ['*://arxiv.org/*']
  });

  // 2. arXiv 링크에서 "이 논문 요약하기"
  chrome.contextMenus.create({
    id: 'summarize-link',
    title: '📄 이 arXiv 논문 요약하기',
    contexts: ['link'],
    targetUrlPatterns: ['*://arxiv.org/abs/*']
  });
});

// Claude API 스트리밍 프록시 (OAuth 토큰 CORS 우회용)
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'claude-api-proxy') return;

  port.onMessage.addListener(async (msg) => {
    try {
      const response = await fetch(msg.url, {
        method: 'POST',
        headers: msg.headers,
        body: JSON.stringify(msg.body)
      });

      if (!response.ok) {
        const error = await response.json();
        port.postMessage({ type: 'error', error: error.error?.message || 'Claude API 오류' });
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

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
                port.postMessage({ type: 'delta', text: data.delta.text });
              }
              if (data.type === 'message_delta' && data.usage) {
                port.postMessage({ type: 'usage_output', output_tokens: data.usage.output_tokens });
              }
              if (data.type === 'message_start' && data.message?.usage) {
                port.postMessage({ type: 'usage_input', input_tokens: data.message.usage.input_tokens });
              }
            } catch (e) {}
          }
        }
      }

      port.postMessage({ type: 'done' });
    } catch (e) {
      port.postMessage({ type: 'error', error: e.message });
    }
  });
});

// Notion API 프록시 (CORS 우회) + 연결 테스트
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'notionTest') {
    notionApiCall('https://api.notion.com/v1/users/me', 'GET', message.token, null)
      .then(data => sendResponse({ success: true, workspaceName: data.name || 'Unknown' }))
      .catch(e => sendResponse({ success: false, error: e.message }));
    return true;
  }

  if (message.action === 'notionCreateDatabase') {
    notionApiCall('https://api.notion.com/v1/databases', 'POST', message.token, message.body)
      .then(data => sendResponse({ success: true, data }))
      .catch(e => sendResponse({ success: false, error: e.message }));
    return true;
  }

  if (message.action === 'notionCreatePage') {
    notionApiCall('https://api.notion.com/v1/pages', 'POST', message.token, message.body)
      .then(data => sendResponse({ success: true, data }))
      .catch(e => sendResponse({ success: false, error: e.message }));
    return true;
  }

  if (message.action === 'notionUpdatePage') {
    notionApiCall(`https://api.notion.com/v1/pages/${message.pageId}`, 'PATCH', message.token, message.body)
      .then(data => sendResponse({ success: true, data }))
      .catch(e => sendResponse({ success: false, error: e.message }));
    return true;
  }

  if (message.action === 'notionQueryDatabase') {
    notionApiCall(`https://api.notion.com/v1/databases/${message.databaseId}/query`, 'POST', message.token, message.body || {})
      .then(data => sendResponse({ success: true, data }))
      .catch(e => sendResponse({ success: false, error: e.message }));
    return true;
  }

  if (message.action === 'notionGetPage') {
    notionApiCall(`https://api.notion.com/v1/pages/${message.pageId}`, 'GET', message.token)
      .then(data => sendResponse({ success: true, data }))
      .catch(e => sendResponse({ success: false, error: e.message }));
    return true;
  }

  if (message.action === 'notionGetBlockChildren') {
    notionApiCall(`https://api.notion.com/v1/blocks/${message.blockId}/children?page_size=100`, 'GET', message.token)
      .then(data => sendResponse({ success: true, data }))
      .catch(e => sendResponse({ success: false, error: e.message }));
    return true;
  }

  if (message.action === 'notionAppendBlocks') {
    notionApiCall(`https://api.notion.com/v1/blocks/${message.blockId}/children`, 'PATCH', message.token, message.body)
      .then(data => sendResponse({ success: true, data }))
      .catch(e => sendResponse({ success: false, error: e.message }));
    return true;
  }
});

async function notionApiCall(url, method, token, body) {
  const options = {
    method,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json'
    }
  };
  if (body) options.body = JSON.stringify(body);

  const response = await fetch(url, options);
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.message || `Notion API 오류: ${response.status}`);
  }
  return response.json();
}

// 컨텍스트 메뉴 클릭 핸들러
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === 'summarize-page') {
    // 현재 페이지 요약
    await chrome.sidePanel.open({ tabId: tab.id });
    // 약간의 딜레이 후 메시지 전송 (사이드패널 로딩 대기)
    setTimeout(() => {
      chrome.runtime.sendMessage({
        action: 'startSummarize',
        type: 'page'
      });
    }, 500);
  }
  else if (info.menuItemId === 'summarize-link') {
    // 링크의 논문 요약 - 새 탭에서 열기
    const arxivUrl = info.linkUrl;

    // 새 탭에서 arXiv 페이지 열기
    const newTab = await chrome.tabs.create({ url: arxivUrl });

    // 페이지 로딩 완료 대기 후 사이드패널 열고 요약 시작
    chrome.tabs.onUpdated.addListener(function listener(tabId, changeInfo) {
      if (tabId === newTab.id && changeInfo.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);

        chrome.sidePanel.open({ tabId: newTab.id });
        setTimeout(() => {
          chrome.runtime.sendMessage({
            action: 'startSummarize',
            type: 'page'
          });
        }, 500);
      }
    });
  }
});
