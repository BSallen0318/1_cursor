import Link from 'next/link';

async function getDoc(id: string) {
  const base = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';
  const res = await fetch(`${base}/api/docs/${id}`, { cache: 'no-store' });
  if (!res.ok) return null;
  return res.json();
}

export default async function DocDetail({ params }: { params: { id: string } }) {
  const data = await getDoc(params.id);
  if (!data) return <main className="p-6">존재하지 않는 문서</main>;
  const { doc, related, timeline } = data;
  return (
    <div className="space-y-4">
      <Link href="/search" className="text-sm text-zinc-500">← 검색으로</Link>
      <h1 className="text-2xl font-semibold">{doc.title}</h1>
      <div className="text-sm text-zinc-600">{doc.path}</div>
      <div className="rounded-2xl border p-4">
        <div className="flex gap-3 border-b mb-3 pb-2 text-sm">
          <a href="#summary">요약</a>
          <a href="#related">관련</a>
          <a href="#timeline">타임라인</a>
        </div>
        <section id="summary" className="space-y-2">
          <h2 className="font-medium">요약</h2>
          <p className="text-zinc-700">{doc.snippet}</p>
        </section>
        <section id="related" className="space-y-2 mt-4">
          <h2 className="font-medium">관련</h2>
          <ul className="list-disc ml-6">
            {related?.map((r: any) => (
              <li key={r.id}><Link href={`/docs/${r.id}`}>{r.title}</Link></li>
            ))}
          </ul>
        </section>
        <section id="timeline" className="space-y-2 mt-4">
          <h2 className="font-medium">타임라인</h2>
          <div className="flex gap-2 flex-wrap">
            {timeline?.map((t: any) => (
              <div key={t.id} className="border rounded-xl px-3 py-2 text-sm">{t.type}: {t.title}</div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}


