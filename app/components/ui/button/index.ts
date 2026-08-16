import type { VariantProps } from "class-variance-authority"
import { cva } from "class-variance-authority"

export { default as Button } from "./Button.vue"

/**
 * Sizes are the design system's control heights (30 / 38 / 46px) rather than
 * shadcn's defaults, and the `soft` variant is TS Database's own — the muted
 * action used inside the "Do next" queue. Hover darkens to the next shade and
 * never moves the control.
 */
export const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md font-semibold leading-none select-none transition-colors duration-[var(--dur-fast)] disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:shadow-[var(--focus-ring)] border border-transparent",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-[var(--brand-strong)]",
        primary: "bg-primary text-primary-foreground hover:bg-[var(--brand-strong)]",
        secondary:
          "bg-card text-[var(--text-strong)] border-border hover:bg-[var(--surface-hover)]",
        outline:
          "bg-card text-[var(--text-strong)] border-border hover:bg-[var(--surface-hover)]",
        ghost: "bg-transparent text-[var(--text-body)] hover:bg-[var(--surface-hover)]",
        soft: "bg-[var(--surface-sunken)] text-[var(--text-strong)] hover:bg-[var(--surface-active)]",
        destructive: "bg-destructive text-white hover:bg-[var(--red-700)]",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        sm: "h-[var(--control-sm)] px-3 text-sm",
        default: "h-[var(--control-md)] px-4 text-base",
        md: "h-[var(--control-md)] px-4 text-base",
        lg: "h-[var(--control-lg)] px-5 text-md",
        "icon-sm": "size-[var(--control-sm)] px-0",
        icon: "size-[var(--control-md)] px-0",
        "icon-lg": "size-[var(--control-lg)] px-0",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
)
export type ButtonVariants = VariantProps<typeof buttonVariants>
