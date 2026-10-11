import { useState } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { Command } from 'cmdk';
import { Check, ChevronDown, FolderKanban, Loader2, Plus, X } from 'lucide-react';
import type { Project } from '@/lib/types';
import { cn, errorMessage } from '@/lib/utils';
import { useProjects, useSaveProject, useUsage, useUsageRank } from '@/data/organization';
import { useToast } from '@/components/ui/toast';

const itemCls = 'flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-sm text-fg aria-selected:bg-raised aria-disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0';

interface Props {
  value: string;
  onChange: (id: string, project: Project | null) => void;
  companyId?: string | null;
  noneLabel?: string;
  className?: string;
}

export function ProjectPicker({ value, onChange, companyId, noneLabel = 'No project', className }: Props) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const projects = useProjects();
  const { data: usage } = useUsage();
  const rank = useUsageRank();
  const save = useSaveProject();
  const toast = useToast();

  const all = projects.data ?? [];
  const ranked = rank(all, 'project', (p) => p.id);
  const selected = all.find((p) => p.id === value) ?? null;
  const term = search.trim();
  const exact = all.some((p) => p.name.toLowerCase() === term.toLowerCase());
  const usesOf = (id: string) => usage?.get(`project:${id}`)?.uses ?? 0;

  const pick = (p: Project | null) => {
    onChange(p?.id ?? '', p);
    setOpen(false);
    setSearch('');
  };

  async function create() {
    if (!term || term.length > 120) return;
    try {
      const id = await save.mutateAsync({ name: term, description: null, status: 'active', owner: 'Doug', next_milestone: null, milestone_date: null, company_id: companyId ?? null, identity: null });
      toast(`Project "${term}" created`);
      onChange(id, { id, name: term, description: null, status: 'active', owner: 'Doug', next_milestone: null, milestone_date: null, company_id: companyId ?? null, identity: null, is_demo: false, updated_at: new Date().toISOString() });
      setOpen(false);
      setSearch('');
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  }

  return (
    <Popover.Root open={open} onOpenChange={(o) => { setOpen(o); if (!o) setSearch(''); }}>
      <Popover.Trigger
        type="button"
        className={cn('input flex items-center gap-2 text-left', !selected && 'text-subtle', className)}
        aria-label={selected ? `Project: ${selected.name}` : 'Choose project'}
      >
        <FolderKanban className="size-4 shrink-0 text-subtle" />
        <span className="min-w-0 flex-1 truncate">{selected?.name ?? noneLabel}</span>
        <ChevronDown className="size-4 shrink-0 text-subtle" />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={4}
          className="z-50 w-[var(--radix-popover-trigger-width)] min-w-[260px] overflow-hidden rounded-lg border border-line bg-surface shadow-xl animate-fade-in"
        >
          <Command label="Choose project" loop>
            <Command.Input
              value={search}
              onValueChange={setSearch}
              placeholder="Search or type a new project name"
              className="h-10 w-full border-b border-line bg-transparent px-3 text-sm text-fg placeholder:text-subtle focus:outline-none"
            />
            <Command.List className="max-h-72 overflow-y-auto p-1">
              {projects.isLoading && <p className="px-2 py-3 text-sm text-muted">Loading projects</p>}
              {projects.error && <p className="px-2 py-3 text-sm text-error-700 dark:text-error-300">Could not load projects. Close and try again.</p>}
              {!term && (
                <Command.Item value="__none" className={cn(itemCls, 'text-muted')} onSelect={() => pick(null)}>
                  <X className="text-subtle" /> {noneLabel}
                  {!value && <Check className="ml-auto text-primary-600 dark:text-primary-400" />}
                </Command.Item>
              )}
              {ranked.length > 0 && (
                <Command.Group heading={usage ? 'Most used first' : 'Projects'} className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:text-subtle">
                  {ranked.map((p) => (
                    <Command.Item key={p.id} value={`${p.name} ${p.id}`} className={itemCls} onSelect={() => pick(p)}>
                      <FolderKanban className="text-subtle" />
                      <span className="min-w-0 flex-1 truncate">{p.name}</span>
                      {usesOf(p.id) > 0 && <span className="text-xs text-subtle">{usesOf(p.id)} uses</span>}
                      {p.id === value && <Check className="text-primary-600 dark:text-primary-400" />}
                    </Command.Item>
                  ))}
                </Command.Group>
              )}
              {term && !exact && (
                <Command.Item value={`__create ${term}`} className={cn(itemCls, 'text-primary-700 dark:text-primary-300')} disabled={save.isPending} onSelect={create}>
                  {save.isPending ? <Loader2 className="animate-spin" /> : <Plus />}
                  <span className="truncate">Create project "{term}"</span>
                </Command.Item>
              )}
              {!projects.isLoading && !term && all.length === 0 && (
                <p className="px-2 py-3 text-sm text-muted">No projects yet. Type a name to create one.</p>
              )}
            </Command.List>
          </Command>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
