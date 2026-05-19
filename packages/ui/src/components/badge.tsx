import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../lib/cn';

const badgeVariants = cva(
  'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors',
  {
    variants: {
      variant: {
        default:     'border-[#d8e0f4] bg-[#eef2fb] text-[#1e2a5c]',
        secondary:   'border-transparent bg-secondary text-secondary-foreground',
        destructive: 'border-[#f1cccc] bg-[#fbeaea] text-[#97251e]',
        success:     'border-[#c9e5d3] bg-[#e7f5ec] text-[#1e6a40]',
        warning:     'border-[#f3dba5] bg-[#fef3e0] text-[#8b5a07]',
        outline:     'text-foreground border-[#d4d4cc] bg-[#fafaf7]',
        gold:        'border-[#f3dba5] bg-[#fef3e0] text-[#8b5a07]',
        navy:        'border-[#d8e0f4] bg-[#eef2fb] text-[#1e2a5c]',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}
