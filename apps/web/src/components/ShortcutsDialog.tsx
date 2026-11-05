import { Dialog, Kbd } from "@readaloud/ui";
import { SHORTCUTS } from "../data/shortcuts";
import { usePlayer } from "../state/player";

export function ShortcutsDialog() {
  const open = usePlayer((s) => s.shortcutsOpen);
  const set = usePlayer((s) => s.setShortcutsOpen);
  return (
    <Dialog open={open} onClose={() => set(false)} title="Keyboard shortcuts">
      <div className="grid grid-cols-1 gap-x-7 gap-y-0.5 sm:grid-cols-2">
        {SHORTCUTS.map(([what, key]) => (
          <div key={what} className="flex items-center justify-between border-b border-line py-2">
            <span className="text-[13px] text-fg2">{what}</span>
            <Kbd>{key}</Kbd>
          </div>
        ))}
      </div>
    </Dialog>
  );
}

export function ShortcutsGrid() {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-x-8 gap-y-1">
      {SHORTCUTS.map(([what, key]) => (
        <div key={what} className="flex items-center justify-between border-b border-line py-2">
          <span className="text-fg2">{what}</span>
          <Kbd>{key}</Kbd>
        </div>
      ))}
    </div>
  );
}
