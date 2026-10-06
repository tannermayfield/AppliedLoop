import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ArtifactRef } from "@/components/evidence/evidence-card";
import { webHref } from "@/lib/safe-url";

// SECURITY_REVIEW L-8: a student-provided address becomes a link only when it is http(s), even if
// a non-web value got stored some other way (seed data, an import, a future integration).

describe("webHref", () => {
  it.each([
    ["https://github.com/example/app/pull/12", "https://github.com/example/app/pull/12"],
    ["http://localhost:3000/x", "http://localhost:3000/x"],
    ["HTTPS://Example.com", "https://example.com/"],
  ])("keeps the web address %s", (value, href) => {
    expect(webHref(value)).toBe(href);
  });

  it.each([
    "javascript:alert(document.cookie)",
    " JavaScript:alert(1)",
    "java\tscript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "vbscript:msgbox(1)",
    "file:///etc/passwd",
    "/relative/path",
    "abc1234",
    "src/services/profile.ts",
    "",
    null,
    undefined,
  ])("refuses %s", (value) => {
    expect(webHref(value)).toBeNull();
  });
});

describe("ArtifactRef", () => {
  const render = (type: "URL" | "COMMIT", value: string) =>
    renderToStaticMarkup(createElement(ArtifactRef, { type, value }));

  it("links a web address in a new tab without opener or referrer", () => {
    const html = render("URL", "https://github.com/example/app/pull/12");
    expect(html).toContain('href="https://github.com/example/app/pull/12"');
    expect(html).toContain('target="_blank"');
    expect(html).toMatch(/rel="[^"]*noopener[^"]*"/);
    expect(html).toMatch(/rel="[^"]*noreferrer[^"]*"/);
  });

  it("shows anything else as text, never as a link", () => {
    for (const value of ["javascript:alert(1)", "data:text/html,x", "abc1234"]) {
      const html = render("COMMIT", value);
      expect(html).not.toContain("<a");
      expect(html).not.toContain("href=");
    }
  });
});
