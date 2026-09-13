import type { VariantProps } from "class-variance-authority"
import { cva } from "class-variance-authority"

export { default as Badge } from "./Badge.vue"

/**
 * A badge is a small solid block of its own tone — the status colour at low
 * saturation behind the status word, with no border.
 *
 * It used to be a few percent of the hue mixed into the card plus a hairline
 * of the same hue. That reads as a tint of the surface rather than as a thing,
 * and it collapses in dark mode, where a pale accent washed into a dark card
 * is very nearly the card. A solid `--*-soft` block carries the same colour
 * coding at a contrast that survives both modes and any surface it lands on —
 * a card, a sunken well, a coloured row.
 *
 * Each variant declares a background and a foreground, both already
 * mode-aware; the base class does the rest.
 */
export const badgeVariants = cva(
  [
    "inline-flex items-center justify-center gap-1 w-fit shrink-0 whitespace-nowrap",
    "rounded-xs px-[0.6em] py-[0.22em]",
    "text-2xs font-medium leading-[1.5]",
    "[&>svg]:size-3 [&>svg]:pointer-events-none",
    "bg-[var(--tone-bg)] text-[var(--tone-fg)]",
  ].join(" "),
  {
    variants: {
      variant: {
        neutral: "[--tone-bg:var(--surface-sunken)] [--tone-fg:var(--text-muted)]",
        brand: "[--tone-bg:var(--brand-soft)] [--tone-fg:var(--brand)]",
        success: "[--tone-bg:var(--success-soft)] [--tone-fg:var(--success)]",
        warning: "[--tone-bg:var(--warning-soft)] [--tone-fg:var(--warning)]",
        danger: "[--tone-bg:var(--danger-soft)] [--tone-fg:var(--danger)]",
        destructive: "[--tone-bg:var(--danger-soft)] [--tone-fg:var(--danger)]",
        info: "[--tone-bg:var(--info-soft)] [--tone-fg:var(--info)]",
        teal: "[--tone-bg:var(--teal-50)] [--tone-fg:var(--teal-700)]",
        cyan: "[--tone-bg:var(--cyan-50)] [--tone-fg:var(--cyan-700)]",
        indigo: "[--tone-bg:var(--indigo-50)] [--tone-fg:var(--indigo-700)]",
        violet: "[--tone-bg:var(--violet-50)] [--tone-fg:var(--violet-700)]",
        rose: "[--tone-bg:var(--rose-50)] [--tone-fg:var(--rose-700)]",
        // `solid` is reserved for the one thing on screen that must dominate.
        solid: "[--tone-bg:var(--brand)] [--tone-fg:var(--text-on-accent)]",
      },
    },
    defaultVariants: {
      variant: "neutral",
    },
  },
)
export type BadgeVariants = VariantProps<typeof badgeVariants>
