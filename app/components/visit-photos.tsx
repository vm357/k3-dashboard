import { Form } from "react-router";

/**
 * Thumbnails for one visit plus an "Add photo" picker that uploads as soon as a file is chosen.
 * `action` is the route that handles intent=photo / photo-delete for this page.
 */
export function VisitPhotos({ base, appointmentId, ids, canAdd, canDelete, action, returnTo, label }: { base: string; appointmentId: string; ids: string[]; canAdd: boolean; canDelete: boolean; action?: string; returnTo?: string; label: string }) {
	if (ids.length === 0 && !canAdd) return null;
	return (
		<div className="flex flex-wrap items-center gap-2">
			{ids.map((id, i) => (
				<div key={id} className="relative">
					<a href={`${base}/photos/${id}`} target="_blank" rel="noreferrer" className="block">
						<img src={`${base}/photos/${id}`} alt={`${label}, photo ${i + 1}`} loading="lazy" className="h-16 w-16 rounded-input bg-canvas-alt object-cover" />
					</a>
					{canDelete ? (
						<Form method="post" action={action} className="absolute -top-1.5 -right-1.5">
							{returnTo ? <input type="hidden" name="returnTo" value={returnTo} /> : null}
							<input type="hidden" name="photoId" value={id} />
							<button type="submit" name="intent" value="photo-delete" aria-label={`Delete photo ${i + 1}`} className="press flex h-6 w-6 items-center justify-center rounded-full bg-card text-xs font-bold text-ink-soft shadow-card">×</button>
						</Form>
					) : null}
				</div>
			))}
			{canAdd && ids.length < 6 ? (
				<Form method="post" action={action} encType="multipart/form-data">
					{returnTo ? <input type="hidden" name="returnTo" value={returnTo} /> : null}
					<input type="hidden" name="intent" value="photo" />
					<input type="hidden" name="appointmentId" value={appointmentId} />
					<label className="press flex h-16 w-16 cursor-pointer flex-col items-center justify-center rounded-input border border-dashed border-input-border bg-card text-xs font-semibold text-cta">
						<span aria-hidden="true" className="text-lg leading-none">+</span>
						Photo
						<input type="file" name="photo" accept="image/jpeg,image/png,image/webp,image/heic" className="sr-only" onChange={(e) => e.currentTarget.form?.requestSubmit()} aria-label={`Add a photo to ${label}`} />
					</label>
				</Form>
			) : null}
		</div>
	);
}
