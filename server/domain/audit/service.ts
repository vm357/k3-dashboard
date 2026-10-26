import type { Tx } from "../../db/client";
import { auditLog } from "../../db/schema";

export interface AuditEntry {
	businessId: string | null;
	actorUserId: string | null;
	action: string;
	targetTable?: string;
	targetId?: string;
	before?: unknown;
	after?: unknown;
	ipAddress?: string;
}

/**
 * Write an audit row inside the caller's transaction, so the action and its record
 * commit or roll back together. Never log contact details or payment data in
 * before/after; services pass the changed business fields only.
 */
export async function recordAudit(tx: Tx, entry: AuditEntry): Promise<void> {
	await tx.insert(auditLog).values({
		businessId: entry.businessId,
		actorUserId: entry.actorUserId,
		action: entry.action,
		targetTable: entry.targetTable,
		targetId: entry.targetId,
		before: entry.before ?? null,
		after: entry.after ?? null,
		ipAddress: entry.ipAddress,
	});
}
