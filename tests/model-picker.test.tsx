import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ModelPicker, pickerGroups } from "@/components/model-picker";
import { DEFAULT_SETTINGS, type Settings } from "@/lib/settings";

it("shares scoped model groups, preserves custom selection and includes unconfigured active provider", () => {
  const settings: Settings = structuredClone(DEFAULT_SETTINGS);
  settings.providers["openai-compatible"].models = [
    "listed",
    "listed",
    settings.providers["openai-compatible"].model,
  ];
  settings.providers.openai = {
    ...settings.providers.openai,
    model: "custom-model",
    models: ["other"],
  };
  expect(pickerGroups(settings, "openai")).toEqual([
    { provider: "openai", label: "OpenAI", models: ["custom-model", "other"] },
  ]);
  expect(
    pickerGroups(settings).find((g) => g.provider === "openai-compatible")
      ?.models,
  ).toEqual(["claude-haiku-5-5", "listed"]);
  settings.provider = "openai";
  expect(pickerGroups(settings).some((g) => g.provider === "openai")).toBe(
    true,
  );
});
it("renders the same accessible shadcn-styled trigger in settings and chat", () => {
  for (const provider of [undefined, "openai-compatible"] as const) {
    const html = renderToStaticMarkup(
      <ModelPicker
        settings={DEFAULT_SETTINGS}
        onChange={() => {}}
        provider={provider}
      />,
    );
    expect(html).toContain('aria-label="Choose model"');
    expect(html).toContain('role="combobox"');
    expect(html).toContain("border-border bg-background text-foreground");
    expect(html).not.toContain("datalist");
    expect(html).toContain("claude-haiku-5-5");
  }
});
