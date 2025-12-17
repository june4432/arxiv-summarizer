let rawMarkdown = '';

document.getElementById('send').addEventListener('click', async () => {
  const status = document.getElementById('status');
  const result = document.getElementById('result');
  const copyBtn = document.getElementById('copyBtn');
  
  status.textContent = '⏳ 파싱 중...';
  result.style.display = 'none';
  copyBtn.style.display = 'none';
  rawMarkdown = '';

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (!tab.url.includes('arxiv.org')) {
    status.textContent = '❌ arXiv 페이지에서 실행해주세요.';
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
    return;
  }

  status.textContent = '⏳ n8n 요청 중... (탭 이동해도 괜찮아요)';

  try {
    const response = await fetch('http://localhost:5678/webhook/12aba2b1-9817-4ba2-9d14-a4141f69a557', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: `제목: ${data.title}\n\n초록: ${data.abstract}\n\nURL: ${data.url}` })
    });

    const json = await response.json();
    
    rawMarkdown = json.result || JSON.stringify(json, null, 2);
    
    status.textContent = '✅ 완료!';
    copyBtn.style.display = 'block';
    result.style.display = 'block';
    result.innerHTML = marked.parse(rawMarkdown);
    
  } catch (e) {
    status.textContent = '❌ 요청 실패: ' + e.message;
  }
});

document.getElementById('copyBtn').addEventListener('click', async () => {
  const copyBtn = document.getElementById('copyBtn');
  
  try {
    await navigator.clipboard.writeText(rawMarkdown);
    copyBtn.textContent = '✅ 복사됨!';
    setTimeout(() => {
      copyBtn.textContent = '📋 마크다운 복사';
    }, 2000);
  } catch (e) {
    copyBtn.textContent = '❌ 복사 실패';
  }
});