import { it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { SettingsToolView, settingsResultLabel } from "@/components/tool-parts";
import { describeSettingsChange } from "@/lib/settings-tools";

const part = (state: string, input: any = {}, output?: any) => ({
  type: "tool-add_mcp_server",
  state,
  input,
  output,
  toolCallId: "t",
  approval: { id: "a" },
});

it("shows the settings approval card with the exact change and safe wording", () => {
  const html = renderToStaticMarkup(
    <SettingsToolView
      part={part("approval-requested", {
        name: "Recap",
        url: "https://example.com/mcp",
        token: "secret-token",
      })}
      name="add_mcp_server"
      onApproval={() => {}}
    />,
  );
  expect(html).toContain('aria-label="Settings approval"');
  expect(html).toContain("Add MCP server “Recap” https://example.com/mcp");
  expect(html).toContain("This changes AMA&#x27;s settings");
  expect(html).toContain("You can undo it in Settings.");
  expect(html).not.toContain("secret-token");
  expect(html).toContain("Deny");
  expect(html).toContain("Allow");
});

it("renders running, denied, error and result chips", () => {
  expect(
    renderToStaticMarkup(
      <SettingsToolView
        part={part("input-available", { url: "https://example.com/mcp" })}
        name="add_mcp_server"
        onApproval={() => {}}
      />,
    ),
  ).toContain("Add MCP server https://example.com/mcp…");
  expect(
    renderToStaticMarkup(
      <SettingsToolView
        part={part("output-denied", { server: "Recap", enabled: false })}
        name="update_mcp_server"
        onApproval={() => {}}
      />,
    ),
  ).toContain("Skipped: Change MCP server “Recap”: switch off");
  expect(
    renderToStaticMarkup(
      <SettingsToolView
        part={part("output-available", {}, { ok: false, error: "Bad URL" })}
        name="add_mcp_server"
        onApproval={() => {}}
      />,
    ),
  ).toContain("Bad URL");
});

it("labels the result chips", () => {
  expect(
    settingsResultLabel(
      "add_mcp_server",
      {
        ok: true,
        connected: true,
        server: { name: "Recap" },
        toolCount: 18,
      },
      "",
    ),
  ).toEqual({
    label: "Connected MCP server Recap · 18 tools",
    warning: false,
  });
  expect(
    settingsResultLabel(
      "add_mcp_server",
      {
        ok: true,
        connected: false,
        server: { name: "Recap" },
        error: "401 Unauthorized",
      },
      "",
    ),
  ).toEqual({
    label: "Saved MCP server Recap, switched off: 401 Unauthorized",
    warning: true,
  });
  expect(
    settingsResultLabel(
      "update_mcp_server",
      { ok: true, server: { name: "R" } },
      "",
    ),
  ).toEqual({ label: "Updated MCP server R", warning: false });
  expect(
    settingsResultLabel("remove_mcp_server", { ok: true, removed: "R" }, ""),
  ).toEqual({ label: "Removed MCP server R", warning: false });
  expect(
    settingsResultLabel("switch_model", { ok: true, model: "m" }, ""),
  ).toEqual({ label: "Switched to m", warning: false });
  expect(
    settingsResultLabel("set_embeddings", { ok: true, enabled: true }, ""),
  ).toEqual({ label: "Embeddings on", warning: false });
  expect(settingsResultLabel("get_settings", {}, "")).toEqual({
    label: "Checked settings",
    warning: false,
  });
});

it("describes every settings change without leaking a token", () => {
  expect(
    describeSettingsChange("update_mcp_server", {
      server: "Recap",
      enabled: false,
      name: "Recap 2",
      url: "https://new",
      token: "secret",
    }),
  ).toBe(
    "Change MCP server “Recap”: switch off, rename to “Recap 2”, URL https://new, new token",
  );
  expect(describeSettingsChange("remove_mcp_server", { server: "Recap" })).toBe(
    "Remove MCP server “Recap”",
  );
  expect(describeSettingsChange("switch_model", { model: "x" })).toBe(
    "Switch the chat model to x",
  );
  expect(describeSettingsChange("set_embeddings", { enabled: false })).toBe(
    "Turn embeddings off",
  );
  expect(describeSettingsChange("set_memory_enabled", { enabled: true })).toBe(
    "Turn memory on",
  );
});
