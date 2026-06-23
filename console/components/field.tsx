import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/** A labelled input for the management forms. */
export function Field({ name, label, type = 'text', placeholder, required, defaultValue }: {
  name: string; label: string; type?: string; placeholder?: string; required?: boolean; defaultValue?: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor={name}>{label}</Label>
      <Input id={name} name={name} type={type} placeholder={placeholder} required={required} defaultValue={defaultValue} className="w-56" />
    </div>
  );
}
