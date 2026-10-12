import { describe, expect, it } from 'vitest';
import { isTimelineIdentity, timelineHref } from './timelines.js';

describe('stable timeline identities', () => {
	it('uses library, kind, and immutable object name, not titles, versions, or generation IDs', () => {
		expect(timelineHref('alz', 'policy', 'Audit-Tags-Mandatory')).toBe('/timelines/alz/policy/Audit-Tags-Mandatory');
		expect(timelineHref('slz', 'archetype', 'name with : ? #')).toBe('/timelines/slz/archetype/name%20with%20%3A%20%3F%20%23');
		expect(timelineHref('alz', 'initiative', 'Tags')).not.toBe(timelineHref('alz', 'policy', 'Tags'));
	});
	it('limits kinds and libraries while preserving valid names', () => {
		expect(isTimelineIdentity({ library: 'alz', kind: 'policy', name: 'Tags' })).toBe(true);
		for (const value of [null, { library: 'amba', kind: 'policy', name: 'Tags' }, { library: 'alz', kind: 'role', name: 'Tags' }, { library: 'alz', kind: 'policy', name: '' }]) {
			expect(isTimelineIdentity(value)).toBe(false);
		}
	});
});
