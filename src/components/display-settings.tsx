import { Button } from "./ui/button";
import {
  DEFAULT_FONT_SCALE,
  FONT_SIZE_OPTIONS,
  getFontScale,
  type Settings,
} from "@/lib/settings";

/** Text size preference. The whole panel scales, so the choice previews live. */
export function DisplaySettings({
  settings,
  onChange,
}: {
  settings: Settings;
  onChange: (s: Settings) => void;
}) {
  const scale = getFontScale(settings);
  return (
    <section aria-label="Display settings">
      <div className="section-heading">
        <h2>Text size</h2>
        {scale !== DEFAULT_FONT_SCALE && (
          <Button
            variant="ghost"
            size="xs"
            onClick={() =>
              onChange({ ...settings, fontScale: DEFAULT_FONT_SCALE })
            }
          >
            Reset
          </Button>
        )}
      </div>
      <p className="hint">
        Make messages, menus and hints easier to read. Spacing stays the same,
        and this panel updates as you choose.
      </p>
      <div
        className="text-size-options"
        role="radiogroup"
        aria-label="Text size"
      >
        {FONT_SIZE_OPTIONS.map((option) => (
          <button
            key={option.scale}
            type="button"
            role="radio"
            aria-checked={option.scale === scale}
            className="text-size-option"
            onClick={() => onChange({ ...settings, fontScale: option.scale })}
          >
            <span
              className="text-size-sample"
              style={{ fontSize: Math.round(13 * option.scale) }}
              aria-hidden="true"
            >
              Aa
            </span>
            {option.label}
          </button>
        ))}
      </div>
      <p className="hint">
        Stored with your settings and included in Chrome configuration sync. It
        changes only how AMA looks, not what is sent to the model.
      </p>
    </section>
  );
}
