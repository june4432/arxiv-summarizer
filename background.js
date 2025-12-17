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
