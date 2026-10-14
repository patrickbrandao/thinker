import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@solidjs/testing-library";

vi.mock("@solidjs/router", () => ({
  A: (props: Record<string, unknown>) => {
    const { href, class: className, children, ...rest } = props;
    return <a href={href as string} class={className as string} {...rest}>{children}</a>;
  },
}));

vi.mock("@solidjs/meta", () => ({
  Title: (props: Record<string, unknown>) => <title>{props.children}</title>,
  Meta: () => null,
}));

import Help from "../../src/pages/Help";

describe("Help", () => {
  it("shows Help & Support heading", () => {
    render(() => <Help />);
    expect(screen.getByText("Help & Support")).toBeDefined();
  });

  it("renders Title metadata", () => {
    const { container } = render(() => <Help />);
    const title = container.querySelector("title");
    expect(title?.textContent).toContain("Help & Support - Thinker");
  });

  it("links the repository docs and issues, in a new tab", () => {
    render(() => <Help />);
    const links = screen.getAllByRole("link");
    expect(links.map((l) => l.getAttribute("href"))).toEqual([
      "https://github.com/patrickbrandao/thinker/tree/main/docs",
      "https://github.com/patrickbrandao/thinker/issues",
    ]);
    for (const link of links) {
      expect(link.getAttribute("target")).toBe("_blank");
      expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    }
  });

  it("has no email support, call booking or Discussions link", () => {
    const { container } = render(() => <Help />);
    expect(container.querySelector('a[href^="mailto:"]')).toBeNull();
    expect(container.textContent).not.toMatch(/manifest|calendly/i);
    expect(container.querySelector('a[href*="discussions"]')).toBeNull();
  });

  it("warns not to paste secrets into a public issue", () => {
    render(() => <Help />);
    expect(screen.getByText(/Leave out keys, tokens and request logs/)).toBeDefined();
  });
});
