import type { LibraryScope } from './libraries.js';

export interface LibraryRelease {
	tag: string;
	version: string;
	url: string;
}

export interface ReleaseDependency extends LibraryRelease {
	sha: string;
}

export interface StoredRelease extends LibraryRelease {
	sha: string;
	referenceSha: string;
	dependency?: ReleaseDependency;
}

export interface ReleaseCatalog {
	schemaVersion: 1;
	syncedAt: string;
	releases: StoredRelease[];
}

export const REPORT_SCHEMA_VERSION = 6;

export type ChangeStatus = 'added' | 'modified' | 'removed';
export type ChangeKind = 'policy' | 'initiative' | 'assignment' | 'archetype' | 'architecture' | 'role' | 'configuration' | 'documentation';

export interface PolicyAssignmentContext {
	assignmentId: string;
	name: string;
	definition: string;
	definitionId: string;
	definitionTitle: string;
	definitionVersion?: string;
	scopes: string[];
	effect: string;
	enforcement: string;
	parameters: string[];
	notes: string[];
	sources: { label: string; url: string }[];
}

export function assignmentContextFacts(context: PolicyAssignmentContext) {
	const { sources, definition, definitionTitle, definitionVersion, ...facts } = context;
	return facts;
}

export interface ReleaseChange {
	id: string;
	kind: ChangeKind;
	title: string;
	description?: string;
	status: ChangeStatus;
	deprecated?: boolean;
	deprecationOnly?: boolean;
	summary: string;
	beforeVersion?: string;
	afterVersion?: string;
	facts: string[];
	warnings: string[];
	assignmentsBefore: PolicyAssignmentContext[];
	assignmentsAfter: PolicyAssignmentContext[];
	sources: { label: string; url: string }[];
}

export interface ComparisonReport {
	schemaVersion: number;
	scope: LibraryScope;
	complete: boolean;
	generatedAt: string;
	from: { tag: string; version: string; sha: string; url: string };
	to: { tag: string; version: string; sha: string; url: string };
	totals: { changed: number; added: number; modified: number; removed: number };
	summary: string;
	changes: ReleaseChange[];
	coverage: { sourceFilesChanged: number; explanation: string };
}

export type ComparisonStatus = 'queued' | 'running' | 'completed' | 'failed';

export interface ComparisonJobMessage {
	jobId: string;
	cacheKey: string;
	fromTag: string;
	toTag: string;
	fromSha: string;
	toSha: string;
	fromDependencySha?: string;
	toDependencySha?: string;
}

export interface ComparisonJob {
	jobId: string;
	cacheKey: string;
	status: ComparisonStatus;
	fromTag: string;
	toTag: string;
	error?: string;
	report?: ComparisonReport;
}
