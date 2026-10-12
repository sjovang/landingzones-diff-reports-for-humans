import { randomUUID } from 'node:crypto';
import { LIBRARIES, libraryForTag, type Library } from '../libraries.js';
import { TIMELINE_SCHEMA_VERSION, isTimelineKind, type TimelineEntry, type TimelineGap, type TimelineIndex, type TimelineReport, type TimelineSummary } from '../timelines.js';
import { analyzeReleases, describeTimelineEntities, type DependencyContext, type ReleaseFiles } from './analysis.js';
import { AppError } from './errors.js';
import { getReleaseCatalog } from './release-catalog.js';
import { loadReleaseSnapshot, getTimelineIndexEtag, publishTimelineIndex, saveTimelineReport } from './storage.js';
import type { StoredRelease } from '../types.js';

interface AvailableTimelineSnapshot {
	release: StoredRelease;
	files: ReleaseFiles;
	dependency?: DependencyContext;
}

type TimelineSnapshot = AvailableTimelineSnapshot | { release: StoredRelease; gapReason: string };

export async function buildLibraryTimelines(
	library: Library, snapshots: Iterable<TimelineSnapshot> | AsyncIterable<TimelineSnapshot>,
	metadata: Pick<TimelineReport, 'generationId' | 'generatedAt' | 'syncedAt'>
): Promise<TimelineReport[]> {
	type Entity = ReturnType<typeof describeTimelineEntities>[number];
	const histories = new Map<string, { entity: Entity; firstRelease: string; entries: TimelineEntry[]; present: boolean | null }>();
	let previous: AvailableTimelineSnapshot | undefined;
	let previousEntities = new Map<string, Entity>();
	let pendingGaps: TimelineEntry[] = [];

	for await (const snapshot of snapshots) {
		if ('gapReason' in snapshot) {
			const entry: TimelineEntry = { release: snapshot.release, status: 'gap', gapReason: snapshot.gapReason };
			pendingGaps.push(entry);
			for (const history of histories.values()) {
				history.entries.push(entry);
				history.present = null;
			}
			previous = undefined;
			previousEntities = new Map();
			continue;
		}
		const entities = new Map(describeTimelineEntities(
			snapshot.files, snapshot.release.sha, snapshot.dependency
		).map((entity) => [entity.id, entity]));
		const changes = previous ? new Map(analyzeReleases(
			previous.files, snapshot.files, previous.release.sha, snapshot.release.sha,
			previous.dependency && snapshot.dependency ? { before: previous.dependency, after: snapshot.dependency } : undefined,
			false
		).changes.filter((change) => isTimelineKind(change.kind)).map((change) => [change.id, change])) : new Map();

		for (const id of new Set([...histories.keys(), ...entities.keys()])) {
			const entity = entities.get(id);
			const history = histories.get(id);
			if (!entity && !history) continue;
			const old = previousEntities.get(id);
			const change = changes.get(id);
			const entry: TimelineEntry = {
				release: snapshot.release,
				status: entity ? (previous ? 'unchanged' : 'first-observed') : 'absent',
				...(entity ? { version: entity.version, source: entity.source, deprecated: entity.deprecated, provenance: entity.provenance } : {})
			};
			if (change) {
				entry.status = change.status === 'added' && history ? 'reintroduced' : change.status;
				entry.change = change;
				entry.changeType = !old || !entity || old.fingerprint !== entity.fingerprint
					|| old.path !== entity.path || old.provenance !== entity.provenance ? 'definition' : 'usage';
			}
			if (history) {
				history.entries.push(entry);
				if (entity) history.entity = entity;
				history.present = Boolean(entity);
			} else if (entity) {
				histories.set(id, { entity, firstRelease: snapshot.release.version, entries: [...pendingGaps, entry], present: true });
			}
		}
		previous = snapshot;
		previousEntities = entities;
		pendingGaps = [];
	}

	return [...histories.values()].map(({ entity, firstRelease, entries, present }): TimelineReport => ({
		schemaVersion: TIMELINE_SCHEMA_VERSION, ...metadata,
		library, kind: entity.kind, name: entity.name, title: entity.title, description: entity.description,
		firstRelease, latestRelease: entries.at(-1)!.release.version,
		firstReleaseStatus: entries.find((entry) => entry.status !== 'gap')?.status === 'added' ? 'added' : 'first-observed',
		deprecatedRelease: entries.find((entry) => entry.deprecated)?.release.version,
		removedRelease: present === false ? [...entries].reverse().find((entry) => entry.status === 'removed')?.release.version : undefined,
		lastUpdatedRelease: present === true
			? [...entries].reverse().find((entry) => entry.status === 'modified' || entry.status === 'added' || entry.status === 'reintroduced')?.release.version
			: undefined,
		presentInLatest: present, deprecated: present === true && entity.deprecated,
		releaseCount: entries.length, changeCount: entries.filter((entry) => entry.change).length,
		gapCount: entries.filter((entry) => entry.status === 'gap').length,
		entries: entries.reverse()
	})).sort((a, b) => a.title.localeCompare(b.title) || a.name.localeCompare(b.name));
}

export async function generateTimelines(
	log: (message: string) => void = console.log,
	generationId: string = randomUUID()
): Promise<TimelineIndex> {
	const previousEtag = await getTimelineIndexEtag();
	const catalog = await getReleaseCatalog();
	const metadata = { generationId, generatedAt: new Date().toISOString(), syncedAt: catalog.syncedAt };
	const reports: TimelineSummary[] = [];
	const gaps: TimelineGap[] = [];
	for (const library of LIBRARIES) {
		// Catalog streams are stored in descending semantic release order.
		const releases = catalog.releases.filter((release) => libraryForTag(release.tag) === library).reverse();
		if (!releases.length) throw new AppError(`No ${library.toUpperCase()} releases are available. Synchronize the catalog before generating timelines.`, 503);
		async function* snapshots(): AsyncGenerator<TimelineSnapshot> {
			for (const release of releases) {
				const files = await loadReleaseSnapshot(release.sha, library);
				let gapReason = !files ? `Missing cached snapshot for ${release.tag}.` : undefined;
				let dependency: DependencyContext | undefined;
				if (files && library === 'slz') {
					if (!release.dependency) {
						gapReason = `Missing pinned ALZ dependency metadata for ${release.tag}. Synchronize the catalog.`;
					} else {
						const dependencyFiles = await loadReleaseSnapshot(release.dependency.sha, 'alz');
						if (!dependencyFiles) gapReason = `Missing cached pinned ALZ snapshot ${release.dependency.tag} for ${release.tag}.`;
						else dependency = { files: dependencyFiles, sha: release.dependency.sha };
					}
				}
				if (files && !gapReason) yield { release, files, dependency };
				else {
					const reason = gapReason!;
					gaps.push({ library, release, reason });
					log(`Coverage gap: ${reason}`);
					yield { release, gapReason: reason };
				}
			}
		}
		log(`Building ${library.toUpperCase()} timelines across ${releases.length} catalog releases.`);
		const timelines = await buildLibraryTimelines(library, snapshots(), metadata);
		for (let offset = 0; offset < timelines.length; offset += 8) {
			await Promise.all(timelines.slice(offset, offset + 8).map(async (report) => {
				await saveTimelineReport(report);
				const { entries, schemaVersion, generationId, generatedAt, syncedAt, ...summary } = report;
				reports.push(summary);
			}));
		}
		log(`Stored ${timelines.length} ${library.toUpperCase()} timelines.`);
	}
	const index: TimelineIndex = {
		schemaVersion: TIMELINE_SCHEMA_VERSION, ...metadata,
		gaps,
		reports: reports.sort((a, b) => a.library.localeCompare(b.library) || a.title.localeCompare(b.title) || a.name.localeCompare(b.name))
	};
	await publishTimelineIndex(index, previousEtag);
	log(`Published ${reports.length} timelines with ${gaps.length} release coverage gaps (${generationId}).`);
	return index;
}
