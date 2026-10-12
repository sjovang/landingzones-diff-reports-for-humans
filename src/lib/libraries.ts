export const LIBRARIES = ['alz', 'slz'] as const;
export type Library = typeof LIBRARIES[number];
export type LibraryScope = `platform/${Library}/`;

export function isExcludedReleaseTag(tag: string): boolean {
	// This legacy tag's upstream snapshot does not match its synchronized commit.
	return tag === 'platform/alz/2024.03.01-legacy';
}

export function isLibrary(value: unknown): value is Library {
	return value === 'alz' || value === 'slz';
}

export function libraryScope(library: Library): LibraryScope {
	return `platform/${library}/`;
}

export function libraryForTag(tag: unknown): Library | null {
	if (typeof tag !== 'string') return null;
	const match = /^platform\/(alz|slz)\/v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.exec(tag);
	return match && isLibrary(match[1]) ? match[1] : null;
}
