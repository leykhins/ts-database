import type { VariantProps } from "class-variance-authority"
import { cva } from "class-variance-authority"

export { default as Alert } from "./Alert.vue"
export { default as AlertDescription } from "./AlertDescription.vue"
export { default as AlertTitle } from "./AlertTitle.vue"

/** Same wash-plus-hairline treatment as Badge, at banner scale. */
export const alertVariants = cva(
  [
    "relative flex gap-3 w-full rounded-md border p-4 text-base",
    "bg-[color-mix(in_srgb,var(--tone)_var(--wash-strength),var(--surface-card))]",
    "border-[color-mix(in_srgb,var(--tone)_20%,transparent)]",
    "text-[var(--text-body)]",
    "[&>svg]:size-[17px] [&>svg]:shrink-0 [&>svg]:mt-px [&>svg]:text-[var(--tone)]",
  ].join(" "),
  {
    variants: {
      variant: {
        info: "[--tone:var(--info)]",
        default: "[--tone:var(--info)]",
        success: "[--tone:var(--success)]",
        warning: "[--tone:var(--warning)]",
        danger: "[--tone:var(--danger)]",
        destructive: "[--tone:var(--danger)]",
      },
    },
    defaultVariants: {
      variant: "info",
    },
  },
)

export type AlertVariants = VariantProps<typeof alertVariants>
