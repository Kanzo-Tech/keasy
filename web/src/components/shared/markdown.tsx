import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface MarkdownProps {
  children: string;
  className?: string;
}

export function Markdown({ children, className }: MarkdownProps) {
  return (
    <div className={className}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
          ul: ({ children }) => <ul className="list-disc pl-4 mb-2">{children}</ul>,
          ol: ({ children }) => <ol className="list-decimal pl-4 mb-2">{children}</ol>,
          li: ({ children }) => <li className="mb-0.5">{children}</li>,
          strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
          code: ({ children }) => (
            <code className="text-xs bg-muted px-1 py-0.5 rounded font-mono">{children}</code>
          ),
          pre: ({ children }) => (
            <pre className="text-xs bg-muted p-2 rounded-md overflow-x-auto font-mono my-2">{children}</pre>
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
