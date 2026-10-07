import type { PolicyAssignmentContext } from './types.js';

interface AssignmentDelta {
	name: string;
	changes: { label: string; before: string; after: string }[];
	unchanged: string[];
}

export function assignmentChanges(
	before: PolicyAssignmentContext[], after: PolicyAssignmentContext[]
): AssignmentDelta[] {
	const previous = new Map(before.map((assignment) => [assignment.assignmentId, assignment]));
	const current = new Map(after.map((assignment) => [assignment.assignmentId, assignment]));
	const results: AssignmentDelta[] = [];
	for (const id of new Set([...previous.keys(), ...current.keys()])) {
		const old = previous.get(id);
		const next = current.get(id);
		if (!old || !next) {
			results.push({
				name: (next ?? old)!.name,
				changes: [{ label: 'Library assignment', before: old ? 'Present' : 'Not assigned', after: next ? 'Present' : 'Removed' }],
				unchanged: []
			});
			continue;
		}
		const changes: AssignmentDelta['changes'] = [];
		const unchanged: string[] = [];
		for (const [label, from, to] of [
			['Assignment name', old.name, next.name],
			['Referenced definition', old.definition, next.definition],
			['Effect', old.effect, next.effect],
			['Enforcement', old.enforcement, next.enforcement],
			['Scopes', [...old.scopes].sort(), [...next.scopes].sort()],
			['Parameters and version selections', [...old.parameters].sort(), [...next.parameters].sort()],
			['Interpretation notes', [...old.notes].sort(), [...next.notes].sort()]
		] as const) {
			if (JSON.stringify(from) !== JSON.stringify(to)) {
				const format = (value: string | readonly string[]) =>
					typeof value === 'string' ? value : value.join('; ') || 'None';
				changes.push({ label, before: format(from), after: format(to) });
			} else if (['Effect', 'Enforcement', 'Scopes', 'Parameters and version selections'].includes(label)) {
				unchanged.push(label.toLowerCase());
			}
		}
		if (changes.length) results.push({ name: next.name, changes, unchanged });
	}
	return results;
}
