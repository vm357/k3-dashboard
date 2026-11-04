import { and, asc, eq, inArray } from "drizzle-orm";
import { can, require, type TenantCtx } from "../../auth/ctx";
import type { Db } from "../../db/client";
import { appointments, visitPhotos } from "../../db/schema";
import { withTenant } from "../../db/tenant";
import type { PhotoBucket } from "../../photos/store";
import { recordAudit } from "../audit/service";
import { assertEmployeeAccess } from "../appointments/service";
import { DomainError } from "../members/service";

export const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic"] as const;
export const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
export const MAX_PHOTOS_PER_VISIT = 6;

/** Photos go on visits that happened: checked in or done. */
export async function addVisitPhoto(db: Db, ctx: TenantCtx, bucket: PhotoBucket | undefined, appointmentId: string, file: { type: string; size: number; arrayBuffer(): Promise<ArrayBuffer> }) {
	require(ctx, "appointments.manage_own");
	if (!bucket) throw new DomainError("photos_not_configured", "Photo storage is not set up yet");
	if (!(PHOTO_TYPES as readonly string[]).includes(file.type)) throw new DomainError("photo_type", "Use a JPEG, PNG, WebP or HEIC photo");
	if (file.size <= 0 || file.size > MAX_PHOTO_BYTES) throw new DomainError("photo_size", "Photos can be up to 10 MB");
	const prep = await withTenant(db, ctx, async (tx) => {
		const [appt] = await tx.select({ id: appointments.id, customerId: appointments.customerId, employeeId: appointments.employeeId, status: appointments.status }).from(appointments).where(and(eq(appointments.id, appointmentId), eq(appointments.businessId, ctx.businessId)));
		if (!appt) throw new DomainError("appointment_not_found");
		await assertEmployeeAccess(tx, ctx, appt.employeeId);
		if (appt.status !== "completed" && appt.status !== "checked_in") throw new DomainError("photo_not_visit", "Add photos once the client is checked in");
		const existing = await tx.select({ id: visitPhotos.id }).from(visitPhotos).where(and(eq(visitPhotos.businessId, ctx.businessId), eq(visitPhotos.appointmentId, appointmentId)));
		if (existing.length >= MAX_PHOTOS_PER_VISIT) throw new DomainError("photo_limit", `Up to ${MAX_PHOTOS_PER_VISIT} photos per visit`);
		return appt;
	});
	const id = crypto.randomUUID();
	const key = `${ctx.businessId}/${prep.customerId}/${id}`;
	await bucket.put(key, await file.arrayBuffer(), { httpMetadata: { contentType: file.type } });
	try {
		return await withTenant(db, ctx, async (tx) => {
			const [row] = await tx.insert(visitPhotos).values({ id, businessId: ctx.businessId, customerId: prep.customerId, appointmentId, r2Key: key, contentType: file.type, sizeBytes: file.size, createdByUserId: ctx.userId }).returning();
			await recordAudit(tx, { businessId: ctx.businessId, actorUserId: ctx.userId, action: "photo.add", targetTable: "visit_photos", targetId: id, after: { appointmentId } });
			return row;
		});
	} catch (err) {
		await bucket.delete(key).catch(() => {});
		throw err;
	}
}

/** Photo ids per appointment, for the client's History and the appointment panel. */
export async function listPhotos(db: Db, ctx: TenantCtx, appointmentIds: string[]) {
	if (!can(ctx, "customers.view") || appointmentIds.length === 0) return {} as Record<string, string[]>;
	const rows = await withTenant(db, ctx, (tx) =>
		tx.select({ id: visitPhotos.id, appointmentId: visitPhotos.appointmentId }).from(visitPhotos).where(and(eq(visitPhotos.businessId, ctx.businessId), inArray(visitPhotos.appointmentId, appointmentIds))).orderBy(asc(visitPhotos.createdAt)),
	);
	const out: Record<string, string[]> = {};
	for (const r of rows) (out[r.appointmentId] ??= []).push(r.id);
	return out;
}

/** The image itself, only if the row is visible to this tenant. */
export async function readPhoto(db: Db, ctx: TenantCtx, bucket: PhotoBucket | undefined, id: string) {
	require(ctx, "customers.view");
	if (!bucket) return null;
	const [row] = await withTenant(db, ctx, (tx) => tx.select({ key: visitPhotos.r2Key, type: visitPhotos.contentType }).from(visitPhotos).where(and(eq(visitPhotos.id, id), eq(visitPhotos.businessId, ctx.businessId))));
	if (!row) return null;
	const obj = await bucket.get(row.key);
	return obj ? { body: obj.body, contentType: row.type } : null;
}

export async function deletePhoto(db: Db, ctx: TenantCtx, bucket: PhotoBucket | undefined, id: string) {
	require(ctx, "customers.edit");
	const key = await withTenant(db, ctx, async (tx) => {
		const [row] = await tx.delete(visitPhotos).where(and(eq(visitPhotos.id, id), eq(visitPhotos.businessId, ctx.businessId))).returning({ key: visitPhotos.r2Key });
		if (!row) throw new DomainError("photo_not_found");
		await recordAudit(tx, { businessId: ctx.businessId, actorUserId: ctx.userId, action: "photo.delete", targetTable: "visit_photos", targetId: id });
		return row.key;
	});
	await bucket?.delete(key).catch(() => {});
}
