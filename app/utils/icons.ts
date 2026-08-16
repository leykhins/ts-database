/**
 * Icon registry — Hugeicons (free stroke set), addressed by the semantic names
 * the TS Database design system uses.
 *
 * The design system names icons by meaning ("shield-check", "heart-pulse") so
 * screens never hard-code a vendor's icon id. This file is the only place the
 * two vocabularies meet: swap the icon library here and nothing else changes.
 *
 * Imports are explicit rather than a namespace import so the bundler ships only
 * the ~50 glyphs this app uses, not all 13,000.
 */
import {
  Alert02Icon,
  AlertCircleIcon,
  AlertDiamondIcon,
  ArrowDown01Icon,
  ArrowLeft01Icon,
  ArrowLeft02Icon,
  ArrowRight01Icon,
  ArrowRight02Icon,
  ArrowUp01Icon,
  Building03Icon,
  Calendar01Icon,
  Camera01Icon,
  Cancel01Icon,
  ChartDownIcon,
  ChartUpIcon,
  CheckmarkCircle02Icon,
  CircleIcon,
  ClipboardIcon,
  CheckListIcon,
  Clock01Icon,
  Cone01Icon,
  DashboardSquare01Icon,
  Delete02Icon,
  DollarCircleIcon,
  Door01Icon,
  Edit02Icon,
  EyeIcon,
  FavouriteIcon,
  File01Icon,
  FilterIcon,
  Flag01Icon,
  HashIcon,
  HeartPulseIcon,
  Home01Icon,
  InboxIcon,
  InformationCircleIcon,
  Key01Icon,
  Loading03Icon,
  LockIcon,
  Logout01Icon,
  Mail01Icon,
  Medicine01Icon,
  Moon01Icon,
  MinusSignIcon,
  MoreHorizontalIcon,
  Navigation01Icon,
  Note01Icon,
  Notification01Icon,
  PlusSignIcon,
  PrinterIcon,
  Refresh01Icon,
  Search01Icon,
  Settings01Icon,
  ShieldUserIcon,
  SidebarLeft01Icon,
  Shield01Icon,
  SunriseIcon,
  SunsetIcon,
  Tick02Icon,
  TaskDone01Icon,
  UnfoldMoreIcon,
  UserAdd01Icon,
  UserCheck01Icon,
  UserGroupIcon,
  UserIcon,
  WrenchIcon,
} from '@hugeicons/core-free-icons'

export type IconNode = [string, Record<string, string | number>]

/** Semantic name → glyph. Add new entries here, never in a screen. */
export const ICONS: Record<string, IconNode[]> = {
  // Functional areas — one icon each, per the design system.
  'layout-dashboard': DashboardSquare01Icon as IconNode[],
  users: UserGroupIcon as IconNode[],
  'dollar-sign': DollarCircleIcon as IconNode[],
  'shield-check': Shield01Icon as IconNode[],
  lock: LockIcon as IconNode[],
  'traffic-cone': Cone01Icon as IconNode[],
  'heart-pulse': HeartPulseIcon as IconNode[],
  wrench: WrenchIcon as IconNode[],
  'clipboard-list': ClipboardIcon as IconNode[],
  'clipboard-plus': ClipboardIcon as IconNode[],
  info: InformationCircleIcon as IconNode[],
  'building-2': Building03Icon as IconNode[],

  // Chrome & controls
  'chevrons-up-down': UnfoldMoreIcon as IconNode[],
  'chevron-down': ArrowDown01Icon as IconNode[],
  'chevron-up': ArrowUp01Icon as IconNode[],
  'chevron-right': ArrowRight01Icon as IconNode[],
  'chevron-left': ArrowLeft01Icon as IconNode[],
  'arrow-right': ArrowRight02Icon as IconNode[],
  'arrow-left': ArrowLeft02Icon as IconNode[],
  bell: Notification01Icon as IconNode[],
  'log-out': Logout01Icon as IconNode[],
  search: Search01Icon as IconNode[],
  check: Tick02Icon as IconNode[],
  x: Cancel01Icon as IconNode[],
  hash: HashIcon as IconNode[],
  printer: PrinterIcon as IconNode[],
  'user-plus': UserAdd01Icon as IconNode[],
  user: UserIcon as IconNode[],
  pencil: Edit02Icon as IconNode[],
  trash: Delete02Icon as IconNode[],
  plus: PlusSignIcon as IconNode[],
  filter: FilterIcon as IconNode[],
  refresh: Refresh01Icon as IconNode[],
  eye: EyeIcon as IconNode[],
  settings: Settings01Icon as IconNode[],
  'shield-user': ShieldUserIcon as IconNode[],
  'panel-left': SidebarLeft01Icon as IconNode[],
  'more-horizontal': MoreHorizontalIcon as IconNode[],
  mail: Mail01Icon as IconNode[],
  key: Key01Icon as IconNode[],

  // Status & feedback
  'trending-up': ChartUpIcon as IconNode[],
  'trending-down': ChartDownIcon as IconNode[],
  'alert-circle': AlertCircleIcon as IconNode[],
  'alert-triangle': Alert02Icon as IconNode[],
  'alert-octagon': AlertDiamondIcon as IconNode[],
  'check-circle-2': CheckmarkCircle02Icon as IconNode[],
  inbox: InboxIcon as IconNode[],
  circle: CircleIcon as IconNode[],
  loader: Loading03Icon as IconNode[],

  // Domain / care-staff set
  home: Home01Icon as IconNode[],
  calendar: Calendar01Icon as IconNode[],
  door: Door01Icon as IconNode[],
  flag: Flag01Icon as IconNode[],
  camera: Camera01Icon as IconNode[],
  pill: Medicine01Icon as IconNode[],
  route: Navigation01Icon as IconNode[],
  moon: Moon01Icon as IconNode[],
  sunrise: SunriseIcon as IconNode[],
  sunset: SunsetIcon as IconNode[],
  'clipboard-check': TaskDone01Icon as IconNode[],
  'list-checks': CheckListIcon as IconNode[],
  'file-text': File01Icon as IconNode[],
  notes: Note01Icon as IconNode[],
  clock: Clock01Icon as IconNode[],
  heart: FavouriteIcon as IconNode[],
  'user-check': UserCheck01Icon as IconNode[],
  minus: MinusSignIcon as IconNode[],
}

/** Normalise "DollarSign" | "dollar_sign" | "Dollar Sign" → "dollar-sign". */
export function toKebab(name: string): string {
  return String(name)
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[\s_]+/g, '-')
    .toLowerCase()
}

export function resolveIcon(name: string): IconNode[] | null {
  return ICONS[name] ?? ICONS[toKebab(name)] ?? null
}
