import { Field as BaseField } from "@base-ui/react/field";
export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <BaseField.Root className="field">
      <BaseField.Label>{label}</BaseField.Label>
      {children}
      {hint && (
        <BaseField.Description className="hint">{hint}</BaseField.Description>
      )}
    </BaseField.Root>
  );
}
