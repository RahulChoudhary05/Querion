import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

export function Markdown({ children, className }: { children: string; className?: string }) {
  return (
    <div className={`prose-q ${className ?? ''}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          blockquote: ({ children }) => <div className="my-3 rounded-xl border border-accent/25 bg-accent-soft px-4 py-2.5 text-[13.5px]">{children}</div>,
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noreferrer" className="text-accent underline-offset-2 hover:underline">
              {children}
            </a>
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
