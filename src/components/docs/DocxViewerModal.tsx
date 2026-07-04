import { useEffect, useRef, useState } from "react";
import { X, Download, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props {
  url: string;
  filename: string;
  onClose: () => void;
}

export function DocxViewerModal({ url, filename, onClose }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function render() {
      try {
        setLoading(true);
        setError(null);
        const [{ renderAsync }, res] = await Promise.all([
          import("docx-preview"),
          fetch(url),
        ]);
        if (!res.ok) throw new Error(`Failed to fetch document (${res.status})`);
        const blob = await res.blob();
        if (cancelled || !containerRef.current) return;
        await renderAsync(blob, containerRef.current, undefined, {
          className: "docx-preview",
          inWrapper: true,
          ignoreWidth: false,
          ignoreHeight: false,
          ignoreFonts: false,
          breakPages: true,
          ignoreLastRenderedPageBreak: true,
          experimental: false,
          trimXmlDeclaration: true,
          useBase64URL: false,
          renderChanges: false,
          renderHeaders: true,
          renderFooters: true,
          renderFootnotes: true,
          renderEndnotes: true,
        });
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? "Failed to render document");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    render();
    return () => { cancelled = true; };
  }, [url]);

  function handleDownload() {
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/60 backdrop-blur-sm">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-2 bg-[#1A0A4A] shrink-0">
        <span className="text-[13px] font-medium text-white truncate max-w-[60%]">{filename}</span>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="ghost"
            className="text-white/70 hover:text-white hover:bg-white/10 gap-1.5 text-[12px]"
            onClick={handleDownload}
          >
            <Download className="w-3.5 h-3.5" />
            Download
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="text-white/70 hover:text-white hover:bg-white/10"
            onClick={onClose}
          >
            <X className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto bg-[#F0F0F0] relative">
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-[#F0F0F0]">
            <div className="flex flex-col items-center gap-3 text-muted-foreground">
              <Loader2 className="w-6 h-6 animate-spin" />
              <span className="text-[13px]">Rendering document…</span>
            </div>
          </div>
        )}
        {error && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="flex flex-col items-center gap-3 text-center max-w-sm">
              <p className="text-[13px] text-destructive">{error}</p>
              <Button size="sm" variant="outline" onClick={handleDownload}>
                <Download className="w-3.5 h-3.5 mr-1.5" />
                Download instead
              </Button>
            </div>
          </div>
        )}
        <div
          ref={containerRef}
          className="min-h-full [&_.docx-wrapper]:!bg-transparent [&_.docx-wrapper]:!p-8 [&_.docx-wrapper]:!flex [&_.docx-wrapper]:!flex-col [&_.docx-wrapper]:!items-center [&_.docx-wrapper]:!gap-8 [&_.docx-wrapper>section]:!shadow-lg [&_.docx-wrapper>section]:!rounded-sm"
        />
      </div>
    </div>
  );
}
