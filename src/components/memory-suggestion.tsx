import { Brain } from "lucide-react";
import type { Memory } from "@/lib/memory/types";
import { acceptSuggestion, dismissSuggestion } from "@/lib/memory/store";
import { Button } from "./ui/button";
export function MemorySuggestion({ memory }: { memory: Memory }) {
  return (
    <div className="memory-suggestion">
      <Brain size={16} />
      <div>
        I noticed: <strong>{memory.text}</strong>
        {memory.scope !== "global" ? ` (on ${memory.scope.slice(7)})` : ""}.
        Remember this?
        <div className="row">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void dismissSuggestion(memory.id)}
          >
            No
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void acceptSuggestion(memory.id)}
          >
            Remember
          </Button>
        </div>
      </div>
    </div>
  );
}
