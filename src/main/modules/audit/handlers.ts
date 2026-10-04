import { z } from 'zod'
import { IPC } from '@shared/ipc'
import { AUDIT_CATEGORIES } from '@shared/types'
import { handle } from '../../ipc'
import type { ChangesService } from '../changes/service'
import type { AuditService } from './service'

const id = z.string().max(80)
const opts = z.object({ categories: z.array(z.enum(AUDIT_CATEGORIES)).min(1).max(AUDIT_CATEGORIES.length) })

export function registerAuditHandlers(audit: AuditService, changes: ChangesService): void {
  handle(IPC.auditPlan, z.tuple([id, opts]), (p, o) => audit.plan(p, o))
  handle(IPC.auditStart, z.tuple([id, opts]), (p, o) => audit.start(p, o))
  handle(IPC.auditStatus, z.tuple([id]), (p) => audit.status(p))
  handle(IPC.auditCancel, z.tuple([id]), (p) => audit.cancel(p))
  handle(IPC.auditDismiss, z.tuple([id, id]), (p, f) => {
    changes.dismissOnly(p, f)
    return audit.status(p)
  })
  handle(IPC.auditFix, z.tuple([id, id]), (p, f) => {
    const finding = audit.find(p, f)
    if (!finding) throw new Error('That finding is gone. Run the audit again.')
    return changes.fixFinding(p, finding)
  })
}
