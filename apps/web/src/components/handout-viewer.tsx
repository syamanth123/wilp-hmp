export function HandoutViewer({ html, empty }: { html: string | null | undefined; empty?: string }) {
  if (!html || !html.trim()) {
    return <p className="text-sm text-muted-foreground">{empty ?? 'No handout content yet.'}</p>;
  }
  return (
    <article
      className="prose prose-sm max-w-none rounded-md border bg-background p-4"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
