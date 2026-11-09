import type {
  ComposerCommand,
  ComposerCommandId,
} from "@/lib/composer-commands";

export function CommandMenu({
  commands,
  selected,
  reasons,
  onSelect,
  onHighlight,
}: {
  commands: ComposerCommand[];
  selected: number;
  reasons: Partial<Record<ComposerCommandId, string>>;
  onSelect: (command: ComposerCommand) => void;
  onHighlight: (index: number) => void;
}) {
  return (
    <div
      className="command-menu"
      id="composer-commands"
      role="listbox"
      aria-label="Composer commands"
    >
      <div className="command-menu-heading">
        Commands · ↑ ↓ select · Tab / Enter complete · Esc close
      </div>
      {commands.map((command, index) => (
        <div
          role="option"
          id={`command-${command.id}`}
          key={command.id}
          aria-selected={index === selected}
          aria-disabled={!!reasons[command.id]}
          className="command-option"
          onMouseMove={() => onHighlight(index)}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            if (!reasons[command.id]) onSelect(command);
          }}
        >
          <strong>
            @{command.id} <span>{command.title}</span>
          </strong>
          <small>{reasons[command.id] || command.description}</small>
        </div>
      ))}
      {!commands.length && (
        <div className="command-empty">
          No matching command. Try compact, memory, 记忆 or 压缩.
        </div>
      )}
    </div>
  );
}
