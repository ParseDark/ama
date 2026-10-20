import { Switch as BaseSwitch } from "@base-ui/react/switch";
export function Switch(props: React.ComponentProps<typeof BaseSwitch.Root>) {
  return (
    <BaseSwitch.Root className="switch" {...props}>
      <BaseSwitch.Thumb className="switch-thumb" />
    </BaseSwitch.Root>
  );
}
