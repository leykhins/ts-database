import { api } from '../../convex/_generated/api'

export type Capability =
  | 'config'
  | 'site-config'
  | 'money'
  | 'care'
  | 'tenancy'
  | 'checks'
  | 'wellness'

export const ROLES = [
  { value: 'admin', label: 'Administrator' },
  { value: 'supervisor', label: 'Building Supervisor' },
  { value: 'front-desk', label: 'Front Desk' },
  { value: 'rsw', label: 'Resident Support Worker' },
  { value: 'wellness', label: 'Wellness Worker' },
  { value: 'home-support', label: 'Home Support Worker' },
  { value: 'care-staff', label: 'Care Staff' },
] as const

export type RoleValue = (typeof ROLES)[number]['value']

/** What each role may do, in the words the UI uses to explain a disabled button. */
export const CAPABILITY_LABEL: Record<Capability, string> = {
  config: 'Buildings, rooms and staff accounts',
  'site-config': 'Meal sittings, laundry hours and supply limits',
  money: 'Rent payments, charges and deposits',
  care: 'Support levels and critical needs',
  tenancy: 'Intake, room moves and exits',
  checks: 'Room checks and work orders',
  wellness: 'Wellness checks and shift reports',
}

/**
 * The signed-in staff member and what they may do.
 *
 * `can()` mirrors the server's capability table exactly. It decides whether a
 * button is disabled — never whether an action is allowed; that is settled in
 * Convex, where `requireCapability` refuses the write regardless of what the
 * client believed.
 */
/** The roles whose home screen is the Care Console rather than the ops dashboard. */
export const FRONTLINE_ROLES: RoleValue[] = [
  'rsw',
  'wellness',
  'home-support',
  'care-staff',
  'front-desk',
]

export function useMe() {
  const { data: me, isLoading } = useConvexQuery(api.users.me)

  /**
   * Frontline workers land on the Care Console. It is judged on the *effective*
   * role, so an administrator testing as a Wellness Worker lands where that
   * worker would — which is the point of the role tester.
   */
  const isFrontline = computed(
    () => !!me.value && FRONTLINE_ROLES.includes(me.value.role as RoleValue),
  )

  const can = (capability: Capability): boolean =>
    me.value?.capabilities?.includes(capability) ?? false

  /** Copy for a control the current role cannot use. */
  const denied = (capability: Capability): string | undefined =>
    can(capability)
      ? undefined
      : me.value?.simulating
        ? `Testing as ${me.value.roleLabel} — this role cannot do this.`
        : `${me.value?.roleLabel ?? 'This role'} cannot do this.`

  return { me, isLoading, isFrontline, can, denied }
}
