import { describe, it, expect, vi } from "vitest";
import {
  fillElement,
  selectElement,
  checkElement,
  describeClickTarget,
} from "@/lib/page-actions";
describe("page actions", () => {
  it("fills using input/change without leaking into names", () => {
    document.body.innerHTML = '<input data-ama-id="e1">';
    const el = document.querySelector("input")!;
    const fn = vi.fn();
    el.addEventListener("input", fn);
    expect(fillElement("e1", "hello").ok).toBe(true);
    expect(el.value).toBe("hello");
    expect(fn).toHaveBeenCalledOnce();
  });
  it("refuses inappropriate fills", () => {
    for (const type of ["file", "checkbox", "submit"]) {
      document.body.innerHTML = `<input data-ama-id="e1" type="${type}">`;
      expect(fillElement("e1", "x").ok).toBe(false);
    }
  });
  it("matches select by value before text and supports contains", () => {
    document.body.innerHTML =
      '<select data-ama-id="e1"><option value="A">Other</option><option value="B">Alpha</option></select>';
    expect(selectElement("e1", "A").ok).toBe(true);
    expect(document.querySelector("select")!.value).toBe("A");
    selectElement("e1", "alph");
    expect(document.querySelector("select")!.value).toBe("B");
  });
  it("checks by clicking only when state differs", () => {
    document.body.innerHTML = '<input type="checkbox" data-ama-id="e1">';
    const el = document.querySelector("input")!,
      fn = vi.fn();
    el.addEventListener("click", fn);
    checkElement("e1", true);
    checkElement("e1", true);
    expect(el.checked).toBe(true);
    expect(fn).toHaveBeenCalledOnce();
  });
  it("classifies committing words and excludes search forms", () => {
    document.body.innerHTML =
      '<button data-ama-id="e1">保存</button><form role="search"><button data-ama-id="e2">Search</button></form><button data-ama-id="e3" type="submit">Continue</button>';
    expect(describeClickTarget("e1").submit).toBe(true);
    expect(describeClickTarget("e2").submit).toBe(false);
    expect(describeClickTarget("e3").submit).toBe(true);
  });
});
