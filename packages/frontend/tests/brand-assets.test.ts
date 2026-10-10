import { describe, it, expect } from "vitest";
import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(__dirname, "../../..");
const brand = resolve(__dirname, "../public/brand");

const svgs = [
  "thinker-mark.svg",
  "thinker-mark-dark.svg",
  "thinker-logo.svg",
  "thinker-logo-dark.svg",
  "favicon.svg",
].map((name) => ({ name, path: resolve(brand, name) }));

const readmeSvgs = ["thinker-logo.svg", "thinker-logo-dark.svg"].map((name) => ({
  name: `.github/assets/${name}`,
  path: resolve(root, ".github/assets", name),
}));

function viewBox(svg: string): number[] {
  const match = svg.match(/viewBox="([^"]+)"/);
  expect(match).not.toBeNull();
  return match![1].split(/\s+/).map(Number);
}

function pngSize(path: string): [number, number] {
  const buf = readFileSync(path);
  expect(buf.subarray(1, 4).toString("latin1")).toBe("PNG");
  return [buf.readUInt32BE(16), buf.readUInt32BE(20)];
}

describe("brand assets", () => {
  for (const { name, path } of [...svgs, ...readmeSvgs]) {
    describe(name, () => {
      const svg = readFileSync(path, "utf8");

      it("is accessible: role=img and a Thinker title", () => {
        expect(svg).toMatch(/<svg[^>]*\srole="img"/);
        expect(svg).toContain("<title>Thinker</title>");
      });

      it("is self-contained: no text, fonts, images, links or editor metadata", () => {
        // CSP forbids external fonts, so the wordmark must be paths.
        expect(svg).not.toMatch(/<(text|image|use|script|foreignObject|metadata)\b/);
        expect(svg).not.toMatch(/href=|@import|url\(/);
        expect(svg).not.toMatch(/inkscape|sodipodi|sketch|figma|illustrator/i);
        const urls = svg.match(/https?:\/\/[^"\s]+/g) ?? [];
        expect(urls).toEqual(["http://www.w3.org/2000/svg"]);
      });

      it("stays small", () => {
        expect(statSync(path).size).toBeLessThan(2048);
      });
    });
  }

  it("keeps the symbol files square", () => {
    for (const name of ["thinker-mark.svg", "thinker-mark-dark.svg", "favicon.svg"]) {
      const [, , w, h] = viewBox(readFileSync(resolve(brand, name), "utf8"));
      expect(w).toBe(h);
    }
  });

  it("ships the README copies unchanged from the brand folder", () => {
    for (const name of ["thinker-logo.svg", "thinker-logo-dark.svg"]) {
      expect(readFileSync(resolve(root, ".github/assets", name), "utf8")).toBe(
        readFileSync(resolve(brand, name), "utf8"),
      );
    }
  });

  it("renders the PNG icons at 32px and 180px", () => {
    expect(pngSize(resolve(brand, "favicon-32.png"))).toEqual([32, 32]);
    expect(pngSize(resolve(brand, "apple-touch-icon.png"))).toEqual([180, 180]);
  });
});
