import { BottomSheet } from "../components/BottomSheet.js";

export function ProvablyFairModal({
  open,
  onClose,
  title = "Provably Fair",
  fields,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  fields: Array<{ label: string; value: string }>;
}) {
  return (
    <BottomSheet open={open} title={title} onClose={onClose}>
      <div className="stack">
        {fields.map((field) => (
          <div key={field.label} className="field">
            <span className="muted">{field.label}</span>
            <code className="pf-value">{field.value}</code>
          </div>
        ))}
      </div>
    </BottomSheet>
  );
}
