document.getElementById('send').addEventListener('click', async () => {
  const status = document.getElementById('status');
  const result = document.getElementById('result');
  
  status.textContent = '⏳ 파싱 중...';
  result.style.display = 'none';

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  // arXiv 페이지인지 확인
  if (!tab.url.includes('arxiv.org')) {
    status.textContent = '❌ arXiv 페이지에서 실행해주세요.';
    return;
  }

  // 페이지에서 정보 추출
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
    return;
  }

  status.textContent = '⏳ n8n 요청 중...';

  try {
    // n8n webhook 호출
    const response = await fetch('http://localhost:5678/webhook/12aba2b1-9817-4ba2-9d14-a4141f69a557', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: `제목: ${data.title}\n\n초록: ${data.abstract}\n\nURL: ${data.url}` })
    });

    const json = await response.json();
    
    status.textContent = '✅ 완료!';
    result.style.display = 'block';
    result.textContent = json.result || JSON.stringify(json, null, 2);
    
  } catch (e) {
    status.textContent = '❌ 요청 실패: ' + e.message;
  }
});