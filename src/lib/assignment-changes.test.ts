import { describe, expect, it } from 'vitest';
import { assignmentChanges } from './assignment-changes.js';
import type { PolicyAssignmentContext } from './types.js';

const assignment: PolicyAssignmentContext = {
	assignmentId: 'guardrails', name: 'Network guardrails',
	definition: 'Network initiative (Network_20250326, version 2.0.0)',
	definitionId: 'Network_20250326', definitionTitle: 'Network initiative', definitionVersion: '2.0.0',
	effect: 'Deny', enforcement: 'DoNotEnforce', scopes: ['Landing zones', 'Platform'],
	parameters: ['TLS: 1.2', 'Version selection: 1.*.*'], notes: [],
	sources: [{ label: 'Source', url: 'https://example.com/old' }]
};

describe('assignment changes', () => {
	it('isolates a replaced initiative from unchanged policy settings', () => {
		const next = { ...assignment, definition: 'Network initiative (Network_20260714, version 2.1.0)', definitionId: 'Network_20260714', definitionVersion: '2.1.0' };
		expect(assignmentChanges([assignment], [next])).toEqual([{
			name: 'Network guardrails',
			changes: [{ label: 'Referenced definition', before: assignment.definition, after: next.definition }],
			unchanged: ['effect', 'enforcement', 'scopes', 'parameters and version selections']
		}]);
	});

	it('ignores source URLs and ordering of assignments and set-like values', () => {
		const other = { ...assignment, assignmentId: 'other' };
		expect(assignmentChanges([assignment, other], [other, {
			...assignment, scopes: [...assignment.scopes].reverse(),
			parameters: [...assignment.parameters].reverse(), sources: []
		}])).toEqual([]);
	});

	it('shows effect, enforcement, scope, parameter and note changes without calling them unchanged', () => {
		const [delta] = assignmentChanges([assignment], [{
			...assignment, effect: 'Audit', enforcement: 'Default', scopes: ['Corp'],
			parameters: [], notes: ['Requires review']
		}]);
		expect(delta.changes.map((change) => change.label)).toEqual([
			'Effect', 'Enforcement', 'Scopes', 'Parameters and version selections', 'Interpretation notes'
		]);
		expect(delta.unchanged).toEqual([]);
		expect(delta.changes[3].after).toBe('None');
	});

	it('distinguishes added and removed assignments', () => {
		expect(assignmentChanges([], [assignment])[0].changes[0]).toEqual({
			label: 'Library assignment', before: 'Not assigned', after: 'Present'
		});
		expect(assignmentChanges([assignment], [])[0].changes[0]).toEqual({
			label: 'Library assignment', before: 'Present', after: 'Removed'
		});
	});
});
