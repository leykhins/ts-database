import { defineComponent, h } from 'vue'
import { resolveIcon } from '~/utils/icons'

/**
 * Icon shims for the shadcn-vue primitives.
 *
 * shadcn ships its components importing glyphs from Lucide. The TS Database
 * design system specifies one icon set — Hugeicons — and a chevron from a
 * second family inside a Select is exactly the kind of drift the design system
 * exists to prevent. These components expose Lucide's names, backed by the
 * Hugeicons registry, so the generated components need only a changed import
 * path and stay otherwise stock (and re-generatable).
 *
 * Sizing comes from the caller's `class` (`size-4`), matching Lucide's own
 * behaviour, so shadcn's markup is untouched.
 */
function icon(name: string) {
  return defineComponent({
    name: `Icon${name}`,
    setup() {
      const nodes = resolveIcon(name)
      return () =>
        h(
          'svg',
          {
            xmlns: 'http://www.w3.org/2000/svg',
            viewBox: '0 0 24 24',
            width: '1em',
            height: '1em',
            fill: 'none',
            stroke: 'currentColor',
            'stroke-width': 1.75,
            'stroke-linecap': 'round',
            'stroke-linejoin': 'round',
            'aria-hidden': 'true',
          },
          nodes
            ? nodes.map(([tag, attrs]) =>
                h(
                  tag,
                  Object.fromEntries(
                    Object.entries(attrs)
                      .filter(([k]) => k !== 'key' && k !== 'stroke' && k !== 'strokeWidth')
                      .map(([k, v]) => [
                        k.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase(),
                        v,
                      ]),
                  ),
                ),
              )
            : [],
        )
    },
  })
}

/* Names below match Lucide's exports, so the shadcn components read unchanged. */
export const Check = icon('check')
export const ChevronDown = icon('chevron-down')
export const ChevronRight = icon('chevron-right')
export const ChevronUp = icon('chevron-up')
export const Circle = icon('circle')
export const X = icon('x')
export const XIcon = X
export const CircleCheckIcon = icon('check-circle-2')
export const InfoIcon = icon('info')
export const Loader2Icon = icon('loader')
export const OctagonXIcon = icon('alert-octagon')
export const TriangleAlertIcon = icon('alert-triangle')
export const PanelLeft = icon('panel-left')
export const PanelLeftIcon = PanelLeft
