import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ToolPart } from "@/components/tool-parts";

function render(name: string, state: string, input: any, output?: any) {
  return renderToStaticMarkup(
    <ToolPart
      part={{
        type: `tool-${name}`,
        toolCallId: `gesture-${name}`,
        state,
        input,
        output,
        approval: { id: "approval" },
      }}
      onApproval={() => {}}
    />,
  );
}
it("renders gesture approvals as built-in actions, not MCP or tab reads", () => {
  const drag = render("drag", "approval-requested", {
    sourceId: "e1",
    targetId: "e2",
  });
  expect(drag).toContain("Drag e1 to e2?");
  expect(drag).toContain("immediately move, save or delete");
  expect(drag).not.toContain("Let server run");
  expect(render("scroll", "approval-requested", { deltaY: 500 })).toContain(
    "Scroll the page by (0, 500)",
  );
  expect(render("double_click", "approval-requested", { id: "e1" })).toContain(
    "Double-click",
  );
});
it("does not label synthetic gestures as verified success", () => {
  for (const name of ["drag", "double_click"]) {
    expect(
      render(name, "output-available", {}, { ok: true, verified: false }),
    ).toContain("events sent · verify result");
    expect(
      render(name, "output-available", {}, { ok: false, error: "Covered" }),
    ).toContain("Covered");
  }
  expect(
    render("scroll", "output-available", {}, { ok: true, moved: false }),
  ).toContain("No scroll movement");
  expect(
    render(
      "scroll",
      "output-available",
      {},
      { ok: true, moved: true, after: { x: 0, y: 500 } },
    ),
  ).toContain("Scrolled to (0, 500)");
});
