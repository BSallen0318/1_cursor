"use client";

import { useEffect, useMemo, useState } from "react";

type Slide = { title: string; bullets?: string[]; note?: string };

const slides: Slide[] = [
  {
    title: "과거와 미래를 잇는 검색 아카이브\nSprint 결과 공유",
    bullets: [
      "기간: 2025 Q3",
      "데모: /search",
      "문의: 와니",
    ],
  },
  {
    title: "검색 – 구글 드라이브",
    bullets: [
      "공유 드라이브 + 나와 공유됨 집계 검색",
      "폴더 재귀(BFS)로 하위 폴더 전부 포함",
      "경로 해석: 부모 체인으로 `폴더/하위/파일` 표시",
      "결과 캡핑/페이지네이션",
    ],
  },
  {
    title: "랭킹/정렬",
    bullets: [
      "제목 > 본문/스니펫 > 의미 유사도(임베딩) > 최신 수정일",
      "fast 모드: 수집량 축소 + 백그라운드 예열로 응답 개선",
    ],
  },
  {
    title: "피그마 연동",
    bullets: [
      "OAuth 연결(Authorize/Callback), 연동 설정 페이지 버튼",
      "인덱싱 API: 프로젝트 파일 목록, 단일 파일 메타",
      "일반 키워드: 팀/프로젝트 범위 내 파일명 매칭",
      "파일키 직접 검색 지원",
    ],
  },
  {
    title: "요약/프리뷰",
    bullets: [
      "고정 높이 프리뷰(최대 8줄, 줄바꿈/단어 래핑)",
      "로딩: ‘문서를 분석하고 있습니다’",
      "프롬프트 개선: 전범위 분석→핵심 서술형(8문장 이내, 메타 배제)",
      "비지원 형식 알림 & 요약 실패 폴백 문구",
    ],
  },
  {
    title: "본문 추출 고도화",
    bullets: [
      "Google Docs/Sheets/Slides 기본 export",
      "Slides 전용 보강 추출: 텍스트 프레임 + 스피커 노트(앞 7페이지)",
    ],
  },
  {
    title: "성능/안정화",
    bullets: [
      "TTL 캐시: sharedWithMe/집계/폴더/BFS/크롤 결과",
      "모델 안정화: gemini-1.5-flash 기본",
      "AI 헬스체크: /api/health/ai?verbose=1",
    ],
  },
  {
    title: "UI/UX & 운영",
    bullets: [
      "입력 라벨/빈 상태 개선, 리스트 메타(작성자 • 최신일자)",
      "선택 문서 하이라이트",
      "Windows 재시작 스크립트: 포트 점검/로그",
      "환경변수/배포 가이드 및 OAuth Redirect 정리",
    ],
  },
  {
    title: "다음 단계 제안",
    bullets: [
      "피그마 자동탐색(조직 권한) 또는 즐겨찾기/최근 항목 크롤",
      "PDF/PPTX 텍스트 추출(OCR 포함) 보강",
      "정밀 모드 토글(임베딩 재랭킹/본문 확장)",
      "배포(Vercel/도커) + 도메인/SSL 적용",
    ],
  },
];

export default function PresentationPage() {
  const [index, setIndex] = useState(0);
  const total = slides.length;
  const slide = useMemo(() => slides[Math.max(0, Math.min(index, total - 1))], [index, total]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" || e.key === "PageDown" || e.key === " ") setIndex((i) => Math.min(i + 1, total - 1));
      if (e.key === "ArrowLeft" || e.key === "PageUp") setIndex((i) => Math.max(i - 1, 0));
      if (e.key === "Home") setIndex(0);
      if (e.key === "End") setIndex(total - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [total]);

  return (
    <main className="min-h-screen bg-white text-zinc-900">
      <div className="mx-auto max-w-5xl p-6">
        <header className="flex items-center justify-between mb-4">
          <div className="text-sm text-zinc-500">슬라이드 {index + 1} / {total}</div>
          <div className="flex gap-2">
            <button className="px-3 h-9 rounded-lg border" onClick={() => setIndex((i) => Math.max(i - 1, 0))}>이전</button>
            <button className="px-3 h-9 rounded-lg border" onClick={() => setIndex((i) => Math.min(i + 1, total - 1))}>다음</button>
          </div>
        </header>
        <section className="rounded-2xl border p-10 min-h-[520px] flex flex-col justify-center">
          <h1 className="text-2xl font-semibold whitespace-pre-wrap leading-relaxed">{slide.title}</h1>
          {slide.bullets && (
            <ul className="mt-6 list-disc pl-6 space-y-2 text-lg">
              {slide.bullets.map((b, i) => (
                <li key={i}>{b}</li>
              ))}
            </ul>
          )}
          {slide.note && <p className="mt-6 text-sm text-zinc-500">{slide.note}</p>}
        </section>
        <footer className="mt-4 text-sm text-zinc-500">
          - 방향키(←/→), PageUp/PageDown, Space 지원. 인쇄(브라우저 Print)로 PDF 생성 가능.
        </footer>
      </div>
      <style jsx global>{`
        @media print {
          body { -webkit-print-color-adjust: exact; }
          main { padding: 0; }
          header, footer { display: none; }
          section { page-break-after: always; height: 95vh; }
        }
      `}</style>
    </main>
  );
}


