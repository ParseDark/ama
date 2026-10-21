import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { DisplaySettings } from "@/components/display-settings";
import { DEFAULT_SETTINGS } from "@/lib/settings";

const render = (fontScale?: number) =>
  renderToStaticMarkup(
    <DisplaySettings
      settings={{ ...DEFAULT_SETTINGS, fontScale }}
      onChange={() => {}}
    />,
  );

it("offers one radio per text size and marks the saved choice", () => {
  const html = render(1.15);
  expect(html.match(/role="radio"/g)).toHaveLength(4);
  expect(html.match(/aria-checked="true"/g)).toHaveLength(1);
  expect(html).toMatch(/aria-checked="true"[^>]*>[^]*Large/);
  for (const label of ["Small", "Default", "Large", "Extra large"])
    expect(html).toContain(label);
});

it("offers a reset only when the text size is not the default", () => {
  expect(render()).not.toContain(">Reset<");
  expect(render(1)).not.toContain(">Reset<");
  expect(render(1.3)).toContain(">Reset<");
});
