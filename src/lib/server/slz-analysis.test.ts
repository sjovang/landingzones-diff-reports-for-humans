import { describe, expect, it } from 'vitest';
import { analyzeReleases, type ReleaseFiles } from './analysis.js';

const slzSha = 'a'.repeat(40);
const nextSlzSha = 'b'.repeat(40);
const alzSha = 'c'.repeat(40);
const nextAlzSha = 'd'.repeat(40);

function file(path: string, value: object): [string, string] {
	return [path, JSON.stringify(value)];
}
function policy(name: string, version: string, effect = 'Audit'): [string, string] {
	return file(`platform/alz/policy_definitions/${name}.json`, {
		name, properties: { displayName: name, metadata: { version },
			policyRule: { if: { field: 'type', equals: 'Microsoft.Storage/storageAccounts' }, then: { effect } } }
	});
}
function initiative(members = ['Used']): [string, string] {
	return file('platform/alz/policy_set_definitions/Controls.json', {
		name: 'Controls', properties: { displayName: 'Controls', metadata: { version: '1.0.0' },
			policyDefinitions: members.map((name) => ({ policyDefinitionReferenceId: name,
				policyDefinitionId: `/providers/Microsoft.Authorization/policyDefinitions/${name}` })) }
	});
}
function slzFiles(): ReleaseFiles {
	return new Map([
		file('platform/slz/policy_assignments/Controls.json', {
			name: 'Controls', properties: { policyDefinitionId: '/providers/Microsoft.Authorization/policySetDefinitions/Controls' }
		}),
		file('platform/slz/archetype_definitions/sovereign.json', {
			name: 'sovereign', policy_assignments: ['Controls']
		}),
		file('platform/slz/architecture_definitions/alz.json', {
			name: 'alz', management_groups: [{ id: 'sovereign', display_name: 'Sovereign workloads', archetypes: ['sovereign'] }]
		})
	]);
}
function compare(before: ReleaseFiles, after: ReleaseFiles, ownBefore = slzFiles(), ownAfter = slzFiles()) {
	return analyzeReleases(ownBefore, ownAfter, slzSha, nextSlzSha, {
		before: { files: before, sha: alzSha }, after: { files: after, sha: nextAlzSha }
	});
}

describe('effective SLZ policy context', () => {
	it('includes used inherited changes but excludes unrelated ALZ entities and scopes', () => {
		const before = new Map([policy('Used', '1.0.0'), policy('Unrelated', '1.0.0'), initiative(),
			file('platform/alz/policy_assignments/Unrelated.json', {
				name: 'Unrelated', properties: { policyDefinitionId: '/providers/Microsoft.Authorization/policyDefinitions/Unrelated' }
			})]);
		const after = new Map([policy('Used', '1.1.0', 'Deny'), policy('Unrelated', '2.0.0'), initiative()]);
		const { changes, sourceFilesChanged } = compare(before, after);
		expect(changes.map((change) => change.id)).toEqual(['policy:Used']);
		expect(sourceFilesChanged).toBe(0);
		const change = changes[0];
		expect(change.assignmentsBefore[0].effect).toContain('Audit');
		expect(change.assignmentsAfter[0].effect).toContain('Deny');
		expect(change.assignmentsAfter[0].scopes).toEqual(['Sovereign workloads (sovereign), architecture: alz']);
		expect(change.sources.find((source) => source.label === 'Previous definition')?.url).toContain(`/blob/${alzSha}/platform/alz/`);
		expect(change.sources.find((source) => source.label === 'New definition')?.url).toContain(`/blob/${nextAlzSha}/platform/alz/`);
		expect(change.sources.find((source) => source.label === 'View source changes on GitHub')?.url).toContain(`/compare/${alzSha}...${nextAlzSha}`);
		expect(change.assignmentsAfter[0].sources.find((source) => source.label === 'Assignment source')?.url).toContain(`/blob/${nextSlzSha}/platform/slz/`);
		expect(change.assignmentsAfter[0].sources.find((source) => source.label === 'Initiative source')?.url).toContain(`/blob/${nextAlzSha}/platform/alz/`);
	});

	it('uses inherited archetypes and assignments only when referenced by the SLZ architecture', () => {
		const before = new Map([policy('Used', '1.0.0'),
			file('platform/alz/policy_assignments/Base.json', { name: 'Base',
				properties: { policyDefinitionId: '/providers/Microsoft.Authorization/policyDefinitions/Used' } }),
			file('platform/alz/archetype_definitions/base.json', { name: 'base', policy_assignments: ['Base'] }),
			file('platform/alz/architecture_definitions/alz.json', {
				name: 'alz', management_groups: [{ id: 'wrong', archetypes: ['base'] }]
			})]);
		const after = new Map([...before, policy('Used', '2.0.0')]);
		const own = new Map([file('platform/slz/architecture_definitions/alz.json', {
			name: 'alz', management_groups: [{ id: 'right', archetypes: ['base'] }]
		})]);
		const { changes } = compare(before, after, own, own);
		expect(changes).toHaveLength(1);
		expect(changes[0].assignmentsAfter[0].scopes).toEqual(['right (right), architecture: alz']);
		expect(changes[0].assignmentsAfter[0].sources.find((source) => source.label === 'Assignment source')?.url)
			.toContain(`/blob/${nextAlzSha}/platform/alz/`);
	});

	it('lets SLZ definitions override inherited identities without duplicate errors', () => {
		const before = new Map([policy('Used', '1.0.0'), initiative()]);
		const after = new Map([policy('Used', '9.0.0', 'Deny'), initiative()]);
		const own = slzFiles();
		const [path, content] = policy('Used', '3.0.0');
		own.set(path.replace('/alz/', '/slz/'), content);
		expect(compare(before, after, own, own).changes).toEqual([]);
	});

	it('does not mislabel an inherited definition as removed when it is no longer referenced', () => {
		const before = new Map([policy('Used', '1.0.0'), initiative()]);
		const after = new Map([policy('Used', '1.0.0'), initiative([])]);
		const change = compare(before, after).changes.find((item) => item.id === 'policy:Used');
		expect(change?.status).toBe('modified');
		expect(change?.assignmentsAfter).toEqual([]);
	});

	it('still rejects duplicate identities inside either source library', () => {
		const base = new Map([policy('Used', '1.0.0')]);
		base.set('platform/alz/policy_definitions/duplicate.json', policy('Used', '1.0.0')[1]);
		expect(() => compare(base, base)).toThrow('duplicate policy identity');
	});
});
