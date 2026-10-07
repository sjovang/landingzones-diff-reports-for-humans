import { describe, expect, it } from 'vitest';
import { analyzeReleases, summarizeChanges, type ReleaseFiles } from './analysis.js';

const policyPath = 'platform/alz/policy_definitions/Require-Nsg.alz_policy_definition.json';
const policyId = '/providers/Microsoft.Management/managementGroups/placeholder/providers/Microsoft.Authorization/policyDefinitions/Require-Nsg';
const initiativeId = '/providers/Microsoft.Management/managementGroups/placeholder/providers/Microsoft.Authorization/policySetDefinitions/Network';
function policy(version = '1.1.0', effect = 'Audit', expected = 'Microsoft.Network/virtualNetworks') {
	return {
		name: 'Require-Nsg',
		properties: {
			displayName: 'Subnets should have a Network Security Group',
			description: 'Checks that subnets are protected by a Network Security Group.',
			metadata: { version }, mode: 'All',
			parameters: { effect: { type: 'String', defaultValue: effect, allowedValues: ['Audit', 'Deny', 'Disabled'] } },
			policyRule: { if: { field: 'type', equals: expected }, then: { effect: "[parameters('effect')]" } }
		}
	};
}
function files(entries: Record<string, unknown>): ReleaseFiles {
	return new Map(Object.entries(entries).map(([path, value]) => [path, JSON.stringify(value)]));
}
function release(definition: unknown = policy(), assignmentEffect = 'Deny'): ReleaseFiles {
	return files({
		[policyPath]: definition,
		'platform/alz/policy_assignments/Network.json': {
			name: 'Network',
			properties: { displayName: 'Protect network resources', policyDefinitionId: policyId,
				scope: '/providers/Microsoft.Management/managementGroups/placeholder',
				parameters: { effect: { value: assignmentEffect } }, enforcementMode: 'Default' }
		},
		'platform/alz/archetype_definitions/corp.json': { name: 'corp', policy_assignments: ['Network'] },
		'platform/alz/architecture_definitions/alz.json': {
			name: 'alz', management_groups: [
				{ id: 'corp', display_name: 'Corp', archetypes: ['corp'] },
				{ id: 'online', display_name: 'Online', archetypes: ['corp'] }
			]
		}
	});
}
function analyze(before: ReleaseFiles, after: ReleaseFiles) {
	return analyzeReleases(before, after, 'a'.repeat(40), 'b'.repeat(40));
}

describe('semantic ALZ reports', () => {
	it('marks a deprecation suffix and its announcement metadata as deprecation-only', () => {
		const original = policy();
		const next = {
			...original,
			properties: {
				...original.properties,
				displayName: `[Deprecated]: ${original.properties.displayName}`,
				description: `${original.properties.description} Superseded by https://www.azadvertizer.net/azpolicyadvertizer/Replacement.html`,
				metadata: { version: '1.1.0-deprecated', deprecated: true, supersededBy: 'Replacement' }
			}
		};
		const change = analyze(release(original), release(next)).changes.find((item) => item.kind === 'policy')!;
		expect(change.deprecationOnly).toBe(true);
		expect(change.summary).toContain('rules and parameters are unchanged');
		const behaviorChanged = { ...next, properties: { ...next.properties, policyRule: {
			...next.properties.policyRule, if: { field: 'type', equals: 'Microsoft.Storage/storageAccounts' }
		} } };
		expect(analyze(release(original), release(behaviorChanged)).changes.find((item) => item.kind === 'policy')?.deprecationOnly).toBeUndefined();
		const descriptionChanged = { ...next, properties: { ...next.properties, description: 'A different purpose.' } };
		expect(analyze(release(original), release(descriptionChanged)).changes.find((item) => item.kind === 'policy')?.deprecationOnly).toBeUndefined();
		const realVersionBump = { ...next, properties: { ...next.properties, metadata: { ...next.properties.metadata, version: '1.2.0-deprecated' } } };
		expect(analyze(release(original), release(realVersionBump)).changes.find((item) => item.kind === 'policy')?.deprecationOnly).toBeUndefined();
		expect(analyze(new Map(), release(next)).changes.find((item) => item.kind === 'policy')?.deprecationOnly).toBeUndefined();
	});

	it('marks deprecated policies only when current release metadata explicitly says so', () => {
		const deprecatedPolicy = policy('1.2.0');
		const after = release({
			...deprecatedPolicy,
			properties: { ...deprecatedPolicy.properties, metadata: { version: '1.2.0', deprecated: true } }
		});
		const change = analyze(release(), after).changes.find((item) => item.kind === 'policy')!;
		expect(change.status).toBe('modified');
		expect(change.deprecated).toBe(true);
		expect(analyze(after, new Map()).changes.find((item) => item.kind === 'policy')?.deprecated).toBeUndefined();
		expect(analyze(release(), release(policy('1.2.0'))).changes[0].deprecated).toBeUndefined();
	});
	it('excludes added, updated, and removed README files from report entries and totals', () => {
		const before = release();
		const after = release();
		before.set('platform/alz/README.md', 'Old overview');
		after.set('platform/alz/README.md', 'Updated overview');
		after.set('platform/alz/policy_definitions/readme.MD', 'New documentation');
		before.set('platform/alz/archetype_definitions/README', 'Removed documentation');
		const { changes, sourceFilesChanged } = analyze(before, after);
		expect(changes).toEqual([]);
		expect(summarizeChanges(changes).totals.changed).toBe(0);
		expect(sourceFilesChanged).toBe(3);
	});

	it('retains policy explanations when README content changes alongside definitions', () => {
		const before = release();
		const after = release(policy('1.2.0'));
		before.set('platform/alz/README.md', 'Old overview');
		after.set('platform/alz/README.md', 'Updated overview');
		const { changes } = analyze(before, after);
		expect(changes).toHaveLength(1);
		expect(changes[0].kind).toBe('policy');
		expect(changes[0].afterVersion).toBe('1.2.0');
	});

	it('explains version, actual rule, defaults, assigned effect, and scope instead of JSON diffs', () => {
		const { changes } = analyze(release(), release(policy('1.2.0', 'Deny', 'Microsoft.Network/virtualNetworks/subnets')));
		const change = changes.find((item) => item.kind === 'policy')!;
		expect(change.title).toBe('Subnets should have a Network Security Group');
		expect(change.beforeVersion).toBe('1.1.0');
		expect(change.afterVersion).toBe('1.2.0');
		expect(change.facts).toContain('Version changed from 1.1.0 to 1.2.0.');
		expect(change.facts).toContain('effect default changed from Audit to Deny.');
		expect(change.facts).toContain('Now matches when resource type equals Microsoft.Network/virtualNetworks/subnets.');
		expect(change.assignmentsAfter[0].effect).toMatch(/^Deny/);
		expect(change.assignmentsAfter[0].scopes).toEqual([
			'Corp (corp), architecture: alz', 'Online (online), architecture: alz'
		]);
		expect(change.sources[0].url).toContain('/blob/' + 'a'.repeat(40));
		expect(change).not.toHaveProperty('patch');
	});

	it('describes new policy purpose, assigned scope, and configured effect', () => {
		const { changes } = analyze(new Map(), release());
		const change = changes.find((item) => item.kind === 'policy')!;
		expect(change.status).toBe('added');
		expect(change.description).toContain('Checks that subnets');
		expect(change.facts).toContain('Default effect: Audit — reports non-compliance without blocking requests.');
		expect(change.assignmentsAfter[0].effect).toMatch(/^Deny/);
	});

	it('does not imply that an unassigned definition is enforced', () => {
		const { changes } = analyze(new Map(), files({ [policyPath]: policy() }));
		expect(changes[0].assignmentsAfter).toEqual([]);
		expect(changes[0].warnings).toContain('No assignment was found in this release. Adding a definition alone does not assign or enforce it.');
	});

	it('follows initiative parameter bindings and assignment overrides without confusing defaults with configured effects', () => {
		const after = release();
		after.set('platform/alz/policy_set_definitions/Network.json', JSON.stringify({
			name: 'Network', properties: {
				parameters: { networkEffect: { defaultValue: 'Audit' } },
				policyDefinitions: [{ policyDefinitionId: policyId, policyDefinitionReferenceId: 'Nsg',
					parameters: { effect: { value: "[parameters('networkEffect')]" } } }]
			}
		}));
		after.set('platform/alz/policy_assignments/Network.json', JSON.stringify({
			name: 'Network', properties: {
				policyDefinitionId: initiativeId, parameters: { networkEffect: { value: 'Disabled' } },
				enforcementMode: 'DoNotEnforce'
			}
		}));
		const { changes } = analyze(new Map(), after);
		const change = changes.find((item) => item.kind === 'policy')!;
		expect(change.assignmentsAfter[0].effect).toMatch(/^Disabled/);
		expect(change.assignmentsAfter[0].enforcement).toContain('not enforced');
		const assignment = JSON.parse(after.get('platform/alz/policy_assignments/Network.json')!);
		assignment.properties.overrides = [{ kind: 'policyEffect', value: 'Audit' }];
		after.set('platform/alz/policy_assignments/Network.json', JSON.stringify(assignment));
		expect(analyze(new Map(), after).changes.find((item) => item.kind === 'policy')!.assignmentsAfter[0].effect)
			.toContain('requires source review');
	});

	it('includes unchanged policies whose assignments or architecture scopes changed', () => {
		const before = release();
		const after = release(policy(), 'Audit');
		const { changes, sourceFilesChanged } = analyze(before, after);
		const change = changes.find((item) => item.kind === 'policy')!;
		expect(change.summary).toBe('Configured assignment effects changed. The policy definition is unchanged.');
		expect(change.assignmentsBefore[0].effect).toMatch(/^Deny/);
		expect(change.assignmentsAfter[0].effect).toMatch(/^Audit/);
		expect(sourceFilesChanged).toBe(1);
		expect(changes.some((item) => item.kind === 'assignment')).toBe(true);
	});

	it('shows a version-only update without inventing a rule change', () => {
		const { changes } = analyze(release(), release(policy('1.2.0')));
		const change = changes.find((item) => item.kind === 'policy')!;
		expect(change.facts).toContain('The policy evaluation rule is unchanged.');
		expect(change.facts.some((fact) => fact.startsWith('Now matches'))).toBe(false);
	});

	it('flags built-in definitions that are not in the release and treats selectors as version selections', () => {
		const path = 'platform/alz/policy_set_definitions/Builtin.json';
		const initiative = (version: string) => ({ name: 'Builtin', properties: { policyDefinitions: [
			{ policyDefinitionReferenceId: 'Builtin', policyDefinitionId: '/providers/Microsoft.Authorization/policyDefinitions/builtin-id',
				definitionVersion: version }
		] } });
		const { changes } = analyze(files({ [path]: initiative('1.*.*') }), files({ [path]: initiative('2.*.*') }));
		expect(changes[0].facts).toContain('Builtin (definition not included) version selection changed from 1.*.* to 2.*.*.');
		expect(changes[0].warnings.join(' ')).toContain('actual version');
	});

	it('flags unsupported policy conditions rather than making behavioral claims', () => {
		const old = policy();
		const next = { ...policy('1.2.0'), properties: { ...old.properties,
			policyRule: { if: { value: "[complexExpression()]", equals: true }, then: old.properties.policyRule.then } } };
		const { changes } = analyze(release(old), release(next));
		expect(changes.find((item) => item.kind === 'policy')!.warnings.join(' ')).toContain('could not be translated');
	});

	it('does not translate an unresolved existence expression as false', () => {
		const old = policy();
		const next = { ...policy(), properties: { ...old.properties,
			policyRule: { if: { field: 'name', exists: "[parameters('mustExist')]" }, then: old.properties.policyRule.then } } };
		const change = analyze(release(old), release(next)).changes.find((item) => item.kind === 'policy')!;
		expect(change.facts.join(' ')).toContain('expression-based existence test');
		expect(change.facts.join(' ')).not.toContain('name does not exist');
		expect(change.warnings.join(' ')).toContain('could not be translated');
	});

	it('does not claim the bundled effect when an assignment selects a different version', () => {
		const after = release();
		const assignment = JSON.parse(after.get('platform/alz/policy_assignments/Network.json')!);
		assignment.properties.definitionVersion = '2.*.*';
		after.set('platform/alz/policy_assignments/Network.json', JSON.stringify(assignment));
		const change = analyze(new Map(), after).changes.find((item) => item.kind === 'policy')!;
		expect(change.assignmentsAfter[0].effect).toContain('version selection does not resolve');
	});

	it('distinguishes a retargeted initiative even when both initiatives have the same display name', () => {
		const before = release();
		const after = release();
		const initiative = (name: string) => ({ name, properties: {
			displayName: 'Network guardrails', metadata: { version: '1.0.0' },
			policyDefinitions: [{ policyDefinitionId: policyId, policyDefinitionReferenceId: 'Nsg' }]
		} });
		before.set('platform/alz/policy_set_definitions/Old.json', JSON.stringify(initiative('Old')));
		after.set('platform/alz/policy_set_definitions/New.json', JSON.stringify(initiative('New')));
		for (const [snapshot, name] of [[before, 'Old'], [after, 'New']] as const) {
			const assignment = JSON.parse(snapshot.get('platform/alz/policy_assignments/Network.json')!);
			assignment.properties.policyDefinitionId = initiativeId.replace('Network', name);
			snapshot.set('platform/alz/policy_assignments/Network.json', JSON.stringify(assignment));
		}
		const { changes } = analyze(before, after);
		const change = changes.find((item) => item.kind === 'assignment')!;
		expect(change.facts.join(' ')).toContain('changed from Old to Network guardrails (New, version 1.0.0)');
		expect(change.assignmentsBefore[0].definition).toContain('(Old,');
		expect(change.assignmentsAfter[0].definition).toContain('(New,');
		expect(changes.some((item) => item.kind === 'policy')).toBe(true);
	});

	it('does not report every unchanged member policy just because its initiative version metadata changed', () => {
		const before = release();
		const after = release();
		for (const [snapshot, version] of [[before, '1.0.0'], [after, '1.1.0']] as const) {
			snapshot.set('platform/alz/policy_set_definitions/Network.json', JSON.stringify({
				name: 'Network', properties: { metadata: { version }, policyDefinitions: [
					{ policyDefinitionId: policyId, policyDefinitionReferenceId: 'Nsg' }
				] }
			}));
			const assignment = JSON.parse(snapshot.get('platform/alz/policy_assignments/Network.json')!);
			assignment.properties.policyDefinitionId = initiativeId;
			snapshot.set('platform/alz/policy_assignments/Network.json', JSON.stringify(assignment));
		}
		const { changes } = analyze(before, after);
		expect(changes.map((change) => change.kind)).toEqual(['initiative']);
	});

	it('ignores formatting-only changes and reports removals with previous context', () => {
		const before = release();
		const after = release();
		after.set(policyPath, JSON.stringify(policy(), null, 2));
		expect(analyze(before, after).changes).toEqual([]);
		after.delete(policyPath);
		const { changes } = analyze(before, after);
		const change = changes.find((item) => item.kind === 'policy')!;
		expect(change.status).toBe('removed');
		expect(change.assignmentsBefore).toHaveLength(1);
		expect(change.assignmentsAfter).toEqual([]);
		expect(summarizeChanges(changes).totals.removed).toBe(1);
	});

	it('fails explicitly on malformed release JSON', () => {
		expect(() => analyze(new Map(), new Map([[policyPath, '{broken}']]))).toThrow('invalid JSON');
	});

	it('keeps identity across source relocation and exposes unhandled changes for review', () => {
		const before = files({ [policyPath]: policy() });
		const after = files({ [policyPath.replace('Require-Nsg', 'Moved-Nsg')]: {
			...policy(), properties: { ...policy().properties, customSetting: true }
		} });
		const { changes } = analyze(before, after);
		expect(changes).toHaveLength(1);
		expect(changes[0].status).toBe('modified');
		expect(changes[0].facts.join(' ')).toContain('source file was relocated');
		expect(changes[0].warnings).toContain('Additional definition properties changed and require source review.');
	});

	it('exposes supporting configuration without a raw diff or an invented interpretation', () => {
		const path = 'platform/alz/alz_library_metadata.json';
		const { changes } = analyze(files({ [path]: { name: 'ALZ', version: '1' } }),
			files({ [path]: { name: 'ALZ', version: '2' } }));
		expect(changes[0].kind).toBe('configuration');
		expect(changes[0].warnings.join(' ')).toContain('not yet semantically interpreted');
		expect(changes[0]).not.toHaveProperty('patch');
	});
});
