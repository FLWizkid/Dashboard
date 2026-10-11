import type { ReactNode } from 'react';
import * as D from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
  side?: 'center' | 'right';
}

export function Dialog({ open, onOpenChange, title, description, children, footer, className, side = 'center' }: DialogProps) {
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-50 bg-black/50 backdrop-blur-[2px] data-[state=open]:animate-fade-in" />
        <D.Content
          className={cn(
            'fixed z-50 flex flex-col border border-line bg-surface shadow-2xl focus:outline-none',
            side === 'center'
              ? 'left-1/2 top-[12vh] max-h-[80vh] w-[calc(100vw-32px)] max-w-lg -translate-x-1/2 rounded-lg animate-fade-in'
              : 'inset-y-0 right-0 w-full max-w-md animate-slide-in',
            className,
          )}
        >
          <div className="flex items-start gap-2 border-b border-line px-4 py-3">
            <div className="flex-1">
              <D.Title className="text-lg font-semibold">{title}</D.Title>
              {description ? <D.Description className="text-sm text-muted">{description}</D.Description> : <D.Description className="sr-only">{title}</D.Description>}
            </div>
            <D.Close className="rounded p-1 text-subtle transition-colors hover:bg-raised hover:text-fg" aria-label="Close">
              <X className="size-4" />
            </D.Close>
          </div>
          <div className="flex-1 overflow-y-auto p-4">{children}</div>
          {footer && <div className="flex justify-end gap-2 border-t border-line px-4 py-3">{footer}</div>}
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}
