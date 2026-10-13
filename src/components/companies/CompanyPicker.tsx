import { useState } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { Command } from 'cmdk';
import { Building2, Check, ChevronDown, Loader2, Plus, X } from 'lucide-react';
import type { Company } from '@/lib/types';
import { cn, errorMessage } from '@/lib/utils';
import { useCompanies, useSaveCompany, useUsage, useUsageRank } from '@/data/organization';
import { useToast } from '@/components/ui/toast';

const itemCls = 'flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-sm text-fg aria-selected:bg-raised aria-disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0';

interface Props {
  value: string;
  onChange: (id: string, company: Company | null) => void;
  noneLabel?: string;
  className?: string;
}

export function CompanyPicker({ value, onChange, noneLabel = 'No company', className }: Props) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const companies = useCompanies();
  const { data: usage } = useUsage();
  const rank = useUsageRank();
  const save = useSaveCompany();
  const toast = useToast();

  const all = companies.data ?? [];
  const ranked = rank(all, 'company', (c) => c.id);
  const selected = all.find((c) => c.id === value) ?? null;
  const term = search.trim();
  const exact = all.some((c) => c.name.toLowerCase() === term.toLowerCase());
  const usesOf = (id: string) => usage?.get(`company:${id}`)?.uses ?? 0;

  const close = () => {
    setOpen(false);
    setSearch('');
  };

  const pick = (c: Company | null) => {
    onChange(c?.id ?? '', c);
    close();
  };

  async function create() {
    if (!term || term.length > 120) return;
    try {
      const id = await save.mutateAsync({ name: term });
      toast(`Company "${term}" created`);
      onChange(id, null);
      close();
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  }

  return (
    <Popover.Root open={open} onOpenChange={(o) => { setOpen(o); if (!o) setSearch(''); }}>
      <Popover.Trigger
        type="button"
        className={cn('input flex items-center gap-2 text-left', !selected && 'text-subtle', className)}
        aria-label={selected ? `Company: ${selected.name}` : 'Choose company'}
      >
        <Building2 className="size-4 shrink-0 text-subtle" />
        <span className="min-w-0 flex-1 truncate">{selected?.name ?? noneLabel}</span>
        <ChevronDown className="size-4 shrink-0 text-subtle" />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={4}
          className="z-50 w-[var(--radix-popover-trigger-width)] min-w-[260px] overflow-hidden rounded-lg border border-line bg-surface shadow-xl animate-fade-in"
        >
          <Command label="Choose company" loop>
            <Command.Input
              value={search}
              onValueChange={setSearch}
              placeholder="Search or type a new company name"
              className="h-10 w-full border-b border-line bg-transparent px-3 text-sm text-fg placeholder:text-subtle focus:outline-none"
            />
            <Command.List className="max-h-72 overflow-y-auto p-1">
              {companies.isLoading && <p className="px-2 py-3 text-sm text-muted">Loading companies</p>}
              {companies.error && <p className="px-2 py-3 text-sm text-error-700 dark:text-error-300">Could not load companies. Close and try again.</p>}
              {!term && (
                <Command.Item value="__none" className={cn(itemCls, 'text-muted')} onSelect={() => pick(null)}>
                  <X className="text-subtle" /> {noneLabel}
                  {!value && <Check className="ml-auto text-primary-600 dark:text-primary-400" />}
                </Command.Item>
              )}
              {ranked.length > 0 && (
                <Command.Group heading={usage ? 'Most used first' : 'Companies'} className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:text-subtle">
                  {ranked.map((c) => (
                    <Command.Item key={c.id} value={`${c.name} ${c.id}`} className={itemCls} onSelect={() => pick(c)}>
                      <Building2 className="text-subtle" />
                      <span className="min-w-0 flex-1 truncate">{c.name}</span>
                      {usesOf(c.id) > 0 && <span className="text-xs text-subtle">{usesOf(c.id)} uses</span>}
                      {c.id === value && <Check className="text-primary-600 dark:text-primary-400" />}
                    </Command.Item>
                  ))}
                </Command.Group>
              )}
              {term && !exact && (
                <Command.Item value={`__create ${term}`} className={cn(itemCls, 'text-primary-700 dark:text-primary-300')} disabled={save.isPending} onSelect={create}>
                  {save.isPending ? <Loader2 className="animate-spin" /> : <Plus />}
                  <span className="truncate">Create company "{term}"</span>
                </Command.Item>
              )}
              {!companies.isLoading && !term && all.length === 0 && (
                <p className="px-2 py-3 text-sm text-muted">No companies yet. Type a name to create one.</p>
              )}
            </Command.List>
          </Command>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
