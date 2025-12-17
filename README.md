# 📄 arXiv to n8n

arXiv 논문 페이지에서 원클릭으로 논문을 요약하는 크롬 익스텐션

![Chrome Extension](https://img.shields.io/badge/Chrome-Extension-green?logo=googlechrome)
![n8n](https://img.shields.io/badge/n8n-Workflow-orange?logo=n8n)

## ✨ 주요 기능

- **원클릭 논문 요약** - arXiv 페이지에서 버튼 하나로 논문 제목, 초록 파싱 및 요약 요청
- **사이드 패널** - 탭 이동해도 꺼지지 않는 사이드 패널 UI
- **마크다운 렌더링** - 요약 결과를 깔끔하게 렌더링
- **복사 기능** - 마크다운 원본 텍스트 클립보드 복사

## 🛠️ 설치 방법

### 1. n8n 설정

Docker로 n8n 실행:

```bash
docker run -d --name n8n -p 5678:5678 \
  -v C:/n8n-data:/home/node/.n8n \
  -v C:/n8n-outputs:/outputs \
  --restart unless-stopped n8nio/n8n
```

n8n에서 워크플로우 생성:
1. **Webhook** 노드 (트리거)
2. **HTTP Request** 노드 (LLM API 호출)
3. **Respond to Webhook** 노드 (결과 반환)

### 2. 크롬 익스텐션 설치

1. 이 저장소 클론 또는 다운로드
2. [marked.min.js](https://cdn.jsdelivr.net/npm/marked/marked.min.js) 다운로드하여 폴더에 추가
3. Chrome → `chrome://extensions` → 개발자 모드 ON
4. "압축해제된 확장 프로그램을 로드합니다" → 폴더 선택

## 📁 파일 구조

```
arxiv-n8n/
├── manifest.json      # 익스텐션 설정
├── background.js      # 서비스 워커
├── sidepanel.html     # 사이드 패널 UI
├── sidepanel.js       # 메인 로직
├── marked.min.js      # 마크다운 렌더러
└── icon.png           # 익스텐션 아이콘
```

## 🚀 사용 방법

1. arXiv 논문 페이지 접속 (예: `https://arxiv.org/abs/xxxx.xxxxx`)
2. 크롬 툴바에서 익스텐션 아이콘 클릭 → 사이드 패널 열림
3. **"논문 요약 요청"** 버튼 클릭
4. 요약 결과 확인 및 마크다운 복사

## 🔮 향후 계획

- [ ] 개인화 옵션 설정
- [ ] Notion 자동 저장
- [ ] Obsidian 볼트 연동
- [ ] Neo4j 엔티티 추출 및 저장
- [ ] 논문 간 관계 그래프 시각화

## 📝 라이선스

MIT License
