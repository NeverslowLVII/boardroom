"use client";

import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Components } from "react-markdown";
import { Copy, Check } from "lucide-react";

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button
      onClick={handleCopy}
      className="flex items-center gap-1 rounded px-2 py-1 text-[11px] text-zinc-500 transition-colors hover:bg-zinc-700 hover:text-zinc-300"
    >
      {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
      {copied ? "Copié" : "Copier"}
    </button>
  );
}

const components: Components = {
  p: ({ children }) => <p className="mb-3 last:mb-0">{children}</p>,
  strong: ({ children }) => <strong className="font-semibold text-zinc-100">{children}</strong>,
  em: ({ children }) => <em className="italic text-zinc-400">{children}</em>,
  ul: ({ children }) => <ul className="mb-3 ml-4 list-disc space-y-1 last:mb-0 marker:text-zinc-600">{children}</ul>,
  ol: ({ children }) => <ol className="mb-3 ml-4 list-decimal space-y-1 last:mb-0 marker:text-zinc-600">{children}</ol>,
  li: ({ children }) => <li className="text-zinc-300 pl-1">{children}</li>,
  h1: ({ children }) => (
    <h1 className="mb-3 mt-6 text-lg font-bold text-zinc-100 first:mt-0">{children}</h1>
  ),
  h2: ({ children }) => (
    <div className="mb-3 mt-5 first:mt-0">
      <h2 className="text-base font-bold text-zinc-100">{children}</h2>
      <div className="mt-1 h-px bg-zinc-800" />
    </div>
  ),
  h3: ({ children }) => <h3 className="mb-2 mt-4 text-sm font-semibold text-zinc-200 first:mt-0">{children}</h3>,
  blockquote: ({ children }) => (
    <blockquote className="mb-3 border-l-2 border-zinc-700 pl-4 text-zinc-400 italic">
      {children}
    </blockquote>
  ),
  code: ({ className, children }) => {
    const match = className?.match(/language-(\w+)/);
    const lang = match?.[1];
    if (lang || className?.includes("language-")) {
      const codeText = String(children).replace(/\n$/, "");
      return (
        <div className="mb-3 overflow-hidden rounded-lg ring-1 ring-zinc-800 last:mb-0">
          <div className="flex items-center justify-between bg-zinc-800/60 px-4 py-2">
            <span className="text-[11px] font-medium uppercase tracking-wider text-zinc-500">
              {lang || "code"}
            </span>
            <CopyButton text={codeText} />
          </div>
          <pre className="overflow-x-auto bg-zinc-900/80 p-4 text-[13px] leading-relaxed text-zinc-300">
            <code>{children}</code>
          </pre>
        </div>
      );
    }
    return (
      <code className="rounded bg-zinc-800 px-1.5 py-0.5 text-[13px] text-zinc-200">
        {children}
      </code>
    );
  },
  pre: ({ children }) => <>{children}</>,
  table: ({ children }) => (
    <div className="mb-3 overflow-hidden rounded-lg ring-1 ring-zinc-800 last:mb-0">
      <table className="w-full border-collapse text-sm">{children}</table>
    </div>
  ),
  thead: ({ children }) => (
    <thead className="bg-zinc-800/50">{children}</thead>
  ),
  th: ({ children }) => (
    <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-zinc-400">{children}</th>
  ),
  tbody: ({ children }) => (
    <tbody className="divide-y divide-zinc-800/50 [&>tr:nth-child(even)]:bg-zinc-900/40">{children}</tbody>
  ),
  td: ({ children }) => (
    <td className="px-4 py-2.5 text-zinc-300">{children}</td>
  ),
  hr: () => <hr className="my-5 border-zinc-800" />,
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noopener noreferrer" className="text-blue-400 underline decoration-blue-400/30 underline-offset-2 hover:decoration-blue-400">
      {children}
    </a>
  ),
};

interface MarkdownContentProps {
  content: string;
}

export function MarkdownContent({ content }: MarkdownContentProps) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
      {content}
    </ReactMarkdown>
  );
}
