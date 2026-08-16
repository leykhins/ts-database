import type { VariantProps } from "class-variance-authority"
import { cva } from "class-variance-authority"

export { default as Badge } from "./Badge.vue"

/**
 * TS Database badges are a wash of the hue over the card with a hairline of the
 * same hue — never a pastel block, never a pill (pills are reserved for avatars
 * and status dots). Each variant just declares its hue and text colour; the
 * base class does the mixing.
 */
export const badgeVariants = cva(
  [
    "inline-flex items-center gap-1 w-fit shrink-0 whitespace-nowrap",
    "rounded-sm border px-[0.55em] py-[0.16em]",
    "text-xs font-semibold leading-[1.4]",
    "[&>svg]:size-3 [&>svg]:pointer-events-none",
    "bg-[color-mix(in_srgb,var(--tone)_var(--wash-strength),var(--surface-card))]",
    "border-[color-mix(in_srgb,var(--tone)_18%,transparent)]",
    "text-[var(--tone-fg)]",
  ].join(" "),
  {
    variants: {
      variant: {
        neutral: "[--tone:var(--slate-500)] [--tone-fg:var(--slate-700)]",
        brand: "[--tone:var(--emerald-600)] [--tone-fg:var(--emerald-700)]",
        success: "[--tone:var(--success)] [--tone-fg:var(--green-700)]",
        warning: "[--tone:var(--amber-600)] [--tone-fg:var(--amber-700)]",
        danger: "[--tone:var(--danger)] [--tone-fg:var(--red-700)]",
        destructive: "[--tone:var(--danger)] [--tone-fg:var(--red-700)]",
        info: "[--tone:var(--info)] [--tone-fg:var(--blue-700)]",
        teal: "[--tone:var(--teal-600)] [--tone-fg:var(--teal-700)]",
        cyan: "[--tone:var(--cyan-600)] [--tone-fg:var(--cyan-700)]",
        indigo: "[--tone:var(--indigo-600)] [--tone-fg:var(--indigo-700)]",
        violet: "[--tone:var(--violet-600)] [--tone-fg:var(--violet-700)]",
        rose: "[--tone:var(--rose-600)] [--tone-fg:var(--rose-700)]",
        // `solid` is reserved for the one thing on screen that must dominate.
        solid: "[--tone:var(--brand)] [--tone-fg:#fff] !bg-[var(--tone)] border-transparent",
      },
    },
    defaultVariants: {
      variant: "neutral",
    },
  },
)
export type BadgeVariants = VariantProps<typeof badgeVariants>
