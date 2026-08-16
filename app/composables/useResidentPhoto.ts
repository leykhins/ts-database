import type { Id } from '../../convex/_generated/dataModel'

export type ResidentPhotoSubject = {
  tenantId?: Id<'tenants'> | null
  name: string
  room?: string | null
  photoUrl?: string | null
  supportLevel?: string | null
  critical?: boolean
}

/**
 * One photo viewer for the whole app.
 *
 * Relief and casual staff do not know residents by face. Every avatar in the
 * app opens this, so "who am I about to knock on" is one click away from
 * wherever you are — a checklist row, an incident form, a roster.
 *
 * State is app-wide rather than per-page so a single dialog is mounted once in
 * the layout; a dialog per avatar would be dozens of them on a 42-room roster.
 */
export function useResidentPhoto() {
  const subject = useState<ResidentPhotoSubject | null>('resident-photo', () => null)

  const open = (next: ResidentPhotoSubject) => {
    subject.value = next
  }

  const close = () => {
    subject.value = null
  }

  return { subject, open, close }
}
