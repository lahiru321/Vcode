import * as React from 'react';
import { cn } from '@renderer/lib/utils';

// A plain <select> styled like Input. The open list is drawn by the OS; its options are
// recoloured so they stay readable in the dark theme.

function NativeSelect({ className, ...props }: React.ComponentProps<'select'>) {
  return (
    <select
      data-slot="native-select"
      className={cn(
        'h-9 w-full rounded-md border border-input bg-transparent px-2.5 text-sm shadow-xs outline-none dark:bg-input/30',
        'focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  );
}

function NativeOption({ className, ...props }: React.ComponentProps<'option'>) {
  return <option className={cn('bg-popover text-popover-foreground', className)} {...props} />;
}

export { NativeOption, NativeSelect };
