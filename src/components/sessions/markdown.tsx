"use client";

import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

// Tutor replies are model output: rendered as Markdown with NO raw HTML, and no images (an image
// URL in model output could quietly send data to another site).
const components: Components = {
  a: ({ children, href }) => (
    <a href={href} target="_blank" rel="noopener noreferrer nofollow" className="underline underline-offset-2">
      {children}
    </a>
  ),
  pre: ({ children }) => (
    <pre className="bg-muted my-3 overflow-x-auto rounded-lg p-3 font-mono text-[0.8rem] leading-relaxed">
      {children}
    </pre>
  ),
  code: ({ children, className }) =>
    className ? (
      <code className={`font-mono ${className}`}>{children}</code>
    ) : (
      <code className="bg-muted rounded px-1 py-0.5 font-mono text-[0.85em]">{children}</code>
    ),
  // Headings in pasted or model text stay small and sit below the page's own h1/h2 (an agent's
  // summary often starts with "## Build summary").
  h1: ({ children }) => <h3 className="mt-3 mb-1 text-sm font-semibold first:mt-0">{children}</h3>,
  h2: ({ children }) => <h3 className="mt-3 mb-1 text-sm font-semibold first:mt-0">{children}</h3>,
  h3: ({ children }) => <h4 className="mt-3 mb-1 text-sm font-semibold first:mt-0">{children}</h4>,
  h4: ({ children }) => <h4 className="mt-3 mb-1 text-sm font-semibold first:mt-0">{children}</h4>,
  h5: ({ children }) => <h4 className="mt-3 mb-1 text-sm font-semibold first:mt-0">{children}</h4>,
  h6: ({ children }) => <h4 className="mt-3 mb-1 text-sm font-semibold first:mt-0">{children}</h4>,
  p: ({ children }) => <p className="my-2 first:mt-0 last:mb-0">{children}</p>,
  ul: ({ children }) => <ul className="my-2 list-disc space-y-1 pl-5">{children}</ul>,
  ol: ({ children }) => <ol className="my-2 list-decimal space-y-1 pl-5">{children}</ol>,
};

export function TutorMarkdown({ children }: { children: string }) {
  return (
    <div className="text-sm leading-relaxed break-words">
      <Markdown remarkPlugins={[remarkGfm]} skipHtml disallowedElements={["img"]} components={components}>
        {children}
      </Markdown>
    </div>
  );
}

/** The student's own words: plain text, with fenced code shown in monospace. */
export function PlainWithCode({ text }: { text: string }) {
  const parts = text.split(/^```[^\n]*\n?/m);
  return (
    <div className="text-sm leading-relaxed break-words">
      {parts.map((part, index) =>
        index % 2 === 1 ? (
          <pre key={index} className="bg-muted my-2 overflow-x-auto rounded-lg p-3 font-mono text-[0.8rem]">
            {part.replace(/\n$/, "")}
          </pre>
        ) : (
          part.trim() && (
            <p key={index} className="whitespace-pre-wrap">
              {part.trim()}
            </p>
          )
        ),
      )}
    </div>
  );
}
