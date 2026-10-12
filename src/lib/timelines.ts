import { isLibrary, type Library } from './libraries.js';
import type { LibraryRelease, ReleaseChange } from './types.js';

export const TIMELINE_SCHEMA_VERSION = 2;
export const TIMELINE_KINDS = ['policy', 'initiative', 'archetype'] as const;
export type TimelineKind = typeof TIMELINE_KINDS[number];
export const timelineKindLabels: Record<TimelineKind, string> = {
	policy: 'Policy definition', initiative: 'Policy set definition', archetype: 'Archetype'
};

export function isTimelineKind(value: unknown): value is TimelineKind {
	return value === 'policy' || value === 'initiative' || value === 'archetype';
}

export function timelineHref(library: Library, kind: TimelineKind, name: string) {
	return `/timelines/${library}/${kind}/${encodeURIComponent(name)}`;
}

export interface TimelineIdentity {
	library: Library;
	kind: TimelineKind;
	name: string;
}

export function isTimelineIdentity(value: unknown): value is TimelineIdentity {
	if (!value || typeof value !== 'object') return false;
	const identity = value as Record<string, unknown>;
	return isLibrary(identity.library) && isTimelineKind(identity.kind)
		&& typeof identity.name === 'string' && identity.name.length > 0 && identity.name.length <= 1024;
}

export type TimelineStatus = 'first-observed' | 'added' | 'reintroduced' | 'modified' | 'removed' | 'unchanged' | 'absent' | 'gap';

export interface TimelineGap {
	library: Library;
	release: LibraryRelease;
	reason: string;
}

export interface TimelineEntry {
	release: LibraryRelease;
	status: TimelineStatus;
	gapReason?: string;
	version?: string;
	source?: string;
	provenance?: Library;
	deprecated?: boolean;
	changeType?: 'definition' | 'usage';
	change?: ReleaseChange;
}

export interface TimelineSummary extends TimelineIdentity {
	title: string;
	description?: string;
	firstRelease: string;
	firstReleaseStatus?: 'added' | 'first-observed';
	deprecatedRelease?: string;
	removedRelease?: string;
	lastUpdatedRelease?: string;
	latestRelease: string;
	presentInLatest: boolean | null;
	deprecated: boolean;
	releaseCount: number;
	changeCount: number;
	gapCount: number;
}

export interface TimelineReport extends TimelineSummary {
	schemaVersion: number;
	generationId: string;
	generatedAt: string;
	syncedAt: string;
	entries: TimelineEntry[];
}

export interface TimelineIndex {
	schemaVersion: number;
	generationId: string;
	generatedAt: string;
	syncedAt: string;
	reports: TimelineSummary[];
	gaps: TimelineGap[];
}
