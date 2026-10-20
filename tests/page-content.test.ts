import { it, expect } from "vitest";
import { extractPageContent, accessibleName } from "@/lib/page-content";
it("indexes stable named controls without typed values", () => {
  document.body.innerHTML =
    '<main><h1>Checkout</h1><label>Name<input value="TOP_SECRET"></label><input type="search" placeholder="Search"><textarea>PRIVATE_TEXT</textarea></main>';
  const first = extractPageContent(document);
  expect(first.elements.join("\n")).toContain('input type=search "Search"');
  expect(first.elements.join("\n")).not.toMatch(/TOP_SECRET|PRIVATE_TEXT/);
  expect(first.markdown).not.toMatch(/TOP_SECRET|PRIVATE_TEXT/);
  expect(extractPageContent(document).elements).toEqual(first.elements);
  expect(accessibleName(document.querySelector("input")!, document)).toBe(
    "Name",
  );
});
it("uses label text without folding select options or editable contents into the name", () => {
  document.body.innerHTML =
    "<label>Region<select><option>United States</option><option>United Kingdom</option></select></label><label>Notes<textarea>PRIVATE</textarea></label>";
  expect(accessibleName(document.querySelector("select")!, document)).toBe(
    "Region",
  );
  expect(accessibleName(document.querySelector("textarea")!, document)).toBe(
    "Notes",
  );
});
it("prioritizes non-links and caps at 400", () => {
  document.body.innerHTML =
    "<main>" +
    Array.from({ length: 450 }, (_, i) => `<a href="/${i}">Link ${i}</a>`).join(
      "",
    ) +
    "<button>Important</button></main>";
  const p = extractPageContent(document);
  expect(p.elements).toHaveLength(400);
  expect(p.elements[0]).toContain("Important");
});
it("strips overlays and noise, renders single-line GFM cells", () => {
  document.body.innerHTML =
    '<main><h1>Article</h1><div id="ama-highlight">EVIL NOTE</div><nav>Navigation</nav><table><thead><tr><th>Name</th><th>Value</th></tr></thead><tbody><tr><td>Alpha<br>Beta</td><td>X</td></tr></tbody></table></main>';
  const p = extractPageContent(document);
  expect(p.markdown).not.toMatch(/EVIL NOTE|Navigation/);
  expect(p.markdown).toContain("Alpha Beta");
  expect(p.markdown).toContain("| Name | Value |");
});
it("truncates large pages with a flag", () => {
  document.body.innerHTML = "<main><p>" + "word ".repeat(25000) + "</p></main>";
  const p = extractPageContent(document);
  expect(p.truncated).toBe(true);
  expect(p.markdown).toHaveLength(120000);
});
