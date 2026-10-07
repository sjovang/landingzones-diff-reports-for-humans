import { createHash } from 'node:crypto';
import { assignmentContextFacts, type ChangeKind, type PolicyAssignmentContext, type ReleaseChange } from '../types.js';
import { AppError } from './errors.js';

type RecordValue = Record<string, unknown>;
export type ReleaseFiles = Map<string, string>;
interface Entity {
	path: string;
	name: string;
	kind: ChangeKind;
	value: RecordValue;
}
interface Inventory {
	entities: Map<string, Entity>;
}
const UPSTREAM = 'https://github.com/Azure/Azure-Landing-Zones-Library';

function record(value: unknown): RecordValue {
	return value !== null && typeof value === 'object' && !Array.isArray(value)
		? value as RecordValue : {};
}
function text(value: unknown): string | undefined {
	return typeof value === 'string' ? value : undefined;
}
function list(value: unknown): unknown[] {
	return Array.isArray(value) ? value : [];
}
function strings(value: unknown): string[] {
	return list(value).filter((item): item is string => typeof item === 'string');
}
function stable(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
	if (value !== null && typeof value === 'object') {
		return `{${Object.entries(record(value)).sort(([a], [b]) => a.localeCompare(b))
			.map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`).join(',')}}`;
	}
	return JSON.stringify(value) ?? 'undefined';
}
function equal(a: unknown, b: unknown): boolean {
	return stable(a) === stable(b);
}
function properties(entity?: Entity): RecordValue {
	return record(entity?.value.properties);
}
function displayName(entity: Entity): string {
	return text(properties(entity).displayName) ?? text(entity.value.display_name) ?? entity.name;
}
function version(entity?: Entity): string | undefined {
	return text(record(properties(entity).metadata).version) ?? text(properties(entity).version);
}
function isDeprecationOnly(before: Entity, after: Entity): boolean {
	const oldVersion = version(before);
	if (!oldVersion || version(after) !== `${oldVersion}-deprecated` || before.path !== after.path) return false;
	const oldMetadata = record(properties(before).metadata);
	const nextMetadata = record(properties(after).metadata);
	if (oldMetadata.deprecated === true || nextMetadata.deprecated !== true) return false;
	const normalize = (entity: Entity, current: boolean): RecordValue => {
		const props = properties(entity);
		const metadata = { ...record(props.metadata) };
		delete metadata.version;
		delete metadata.deprecated;
		if (current && oldMetadata.supersededBy === undefined) delete metadata.supersededBy;
		let description = props.description;
		const replacement = text(nextMetadata.supersededBy);
		if (current && typeof description === 'string' && replacement) {
			const category = entity.kind === 'initiative' ? 'azpolicyinitiativesadvertizer' : 'azpolicyadvertizer';
			const suffix = ` Superseded by https://www.azadvertizer.net/${category}/${replacement}.html`;
			if (description.endsWith(suffix)) description = description.slice(0, -suffix.length);
		}
		return {
			...entity.value,
			properties: {
				...props, metadata, description,
				displayName: current && typeof props.displayName === 'string'
					? props.displayName.replace(/^\[Deprecated\]:\s*/, '') : props.displayName,
				version: current && props.version === `${oldVersion}-deprecated`
					? properties(before).version : props.version
			}
		};
	};
	return equal(normalize(before, false), normalize(after, true));
}
function kindFor(path: string): ChangeKind {
	if (path.includes('/policy_definitions/')) return 'policy';
	if (path.includes('/policy_set_definitions/')) return 'initiative';
	if (path.includes('/policy_assignments/')) return 'assignment';
	if (path.includes('/archetype_definitions/')) return 'archetype';
	if (path.includes('/architecture_definitions/')) return 'architecture';
	if (path.includes('/role_definitions/')) return 'role';
	return path.endsWith('.md') ? 'documentation' : 'configuration';
}
function inventory(files: ReleaseFiles): Inventory {
	const entities = new Map<string, Entity>();
	for (const [path, content] of files) {
		if (!path.endsWith('.json')) continue;
		let value: unknown;
		try {
			value = JSON.parse(content);
		} catch (error) {
			console.error('Invalid JSON in ALZ release inventory.', { path, error });
			throw new AppError(`The release contains invalid JSON in ${path}; policy context cannot be analyzed reliably.`, 502);
		}
		if (!value || typeof value !== 'object' || Array.isArray(value)) {
			throw new AppError(`Expected a JSON object in ${path}; policy context cannot be analyzed reliably.`, 502);
		}
		const data = record(value);
		const kind = kindFor(path);
		const name = text(data.name) ?? path;
		const id = `${kind}:${name}`;
		if (entities.has(id)) throw new AppError(`The release contains duplicate ${kind} identity "${name}".`, 502);
		entities.set(id, { path, name, kind, value: data });
	}
	return { entities };
}
function referenceName(id: unknown): string {
	return (text(id) ?? '').split('/').at(-1) ?? '';
}
function findReference(source: Inventory, id: unknown): Entity | undefined {
	const value = text(id) ?? '';
	const kind = /\/policySetDefinitions\//i.test(value) ? 'initiative' : 'policy';
	return source.entities.get(`${kind}:${referenceName(value)}`);
}
function parameterValues(entity: Entity): RecordValue {
	return Object.fromEntries(Object.entries(record(properties(entity).parameters))
		.filter(([, value]) => 'defaultValue' in record(value))
		.map(([key, value]) => [key, record(value).defaultValue]));
}
function resolveValue(value: unknown, parameters: RecordValue): unknown {
	if (typeof value !== 'string') return value;
	const match = /^\[parameters\(['"]([^'"]+)['"]\)\]$/i.exec(value);
	return match ? parameters[match[1]] : value;
}
function assignmentParameters(assignment: Entity, definition: Entity): RecordValue {
	return {
		...parameterValues(definition),
		...Object.fromEntries(Object.entries(record(properties(assignment).parameters))
			.map(([key, value]) => [key, record(value).value]))
	};
}
function readableValue(value: unknown): string {
	if (value === undefined) return 'not specified';
	if (value === null) return 'none';
	if (Array.isArray(value)) return value.length ? value.map(readableValue).join(', ') : 'none';
	if (typeof value === 'object') return 'a structured value (see source)';
	if (typeof value === 'string') {
		const parameter = /^\[parameters\(['"]([^'"]+)['"]\)\]$/i.exec(value);
		if (parameter) return `configured ${label(parameter[1])}`;
		if (value.startsWith('[')) return 'an expression requiring source review';
		if (value.includes('${')) return 'a deployment-supplied value';
	}
	return value === '' ? 'empty value' : String(value);
}
const EFFECTS: Record<string, string> = {
	audit: 'Audit — reports non-compliance without blocking requests',
	deny: 'Deny — blocks matching non-compliant requests',
	disabled: 'Disabled — policy evaluation is disabled',
	auditifnotexists: 'AuditIfNotExists — audits when a related resource is missing or non-compliant',
	deployifnotexists: 'DeployIfNotExists — can deploy or update a related resource',
	modify: 'Modify — can change resource properties',
	append: 'Append — adds properties to matching resource requests',
	denyaction: 'DenyAction — blocks the actions specified by the policy',
	manual: 'Manual — requires manual compliance attestation'
};
function effectDescription(value: unknown): string {
	const effect = text(value);
	if (!effect || effect.startsWith('[') || effect.includes('${')) {
		return 'Effect unresolved — supplied at deployment or uses an unsupported expression';
	}
	return EFFECTS[effect.toLowerCase()] ?? `${effect} — behavior requires source review`;
}
function policyEffect(policy: Entity, parameters = parameterValues(policy)): string {
	const then = record(record(properties(policy).policyRule).then);
	return effectDescription(resolveValue(then.effect, parameters));
}
function matchesVersion(entity: Entity, selection: unknown): boolean {
	if (selection === undefined) return true;
	const selected = text(selection);
	const bundled = version(entity);
	if (!selected || !bundled) return false;
	if (selected === bundled) return true;
	if (!/^(?:\d+|\*)\.(?:\d+|\*)\.(?:\d+|\*)$/.test(selected) || !/^\d+\.\d+\.\d+$/.test(bundled)) return false;
	return selected.split('.').every((part, index) => part === '*' || part === bundled.split('.')[index]);
}
function scopeFor(source: Inventory, assignment: Entity): { scopes: string[]; evidence: Entity[] } {
	const scopes = new Set<string>();
	const evidence = new Set<Entity>();
	const archetypes = [...source.entities.values()].filter((entity) =>
		entity.kind === 'archetype' && strings(entity.value.policy_assignments).includes(assignment.name));
	for (const archetype of archetypes) {
		evidence.add(archetype);
		let mapped = false;
		for (const architecture of source.entities.values()) {
			if (architecture.kind !== 'architecture') continue;
			for (const groupValue of list(architecture.value.management_groups)) {
				const group = record(groupValue);
				if (!strings(group.archetypes).includes(archetype.name)) continue;
				evidence.add(architecture);
				scopes.add(`${text(group.display_name) ?? text(group.id) ?? 'Unnamed management group'} (${text(group.id) ?? 'unknown id'}), architecture: ${architecture.name}`);
				mapped = true;
			}
		}
		if (!mapped) scopes.add(`Archetype: ${archetype.name} — no management group mapping found`);
	}
	const declared = text(properties(assignment).scope);
	if (!scopes.size && declared && !/placeholder|contoso|\$\{/.test(declared)) {
		scopes.add(`Declared scope: ${declared}`);
	}
	if (!scopes.size) scopes.add('No library assignment scope resolved');
	return { scopes: [...scopes].sort(), evidence: [...evidence] };
}
function contexts(source: Inventory, entity: Entity, sha: string): PolicyAssignmentContext[] {
	const results: PolicyAssignmentContext[] = [];
	for (const assignment of source.entities.values()) {
		if (assignment.kind !== 'assignment') continue;
		if (entity.kind === 'assignment' && assignment.name !== entity.name) continue;
		const target = findReference(source, properties(assignment).policyDefinitionId);
		let effect: string;
		let resolvedParameters: RecordValue | undefined;
		const memberNotes: string[] = [];
		if (entity.kind === 'assignment') {
			effect = target?.kind === 'policy'
				? policyEffect(target, assignmentParameters(assignment, target))
				: target?.kind === 'initiative'
					? 'Multiple policy effects — see the initiative and its member policies'
					: 'Effect unresolved — referenced definition is not included in this ALZ release';
		} else if (target?.kind === entity.kind && target.name === entity.name) {
			if (entity.kind === 'policy') resolvedParameters = assignmentParameters(assignment, entity);
			effect = entity.kind === 'policy'
				? policyEffect(entity, resolvedParameters)
				: 'Multiple policy effects — see member policies';
		} else if (entity.kind === 'policy' && target?.kind === 'initiative') {
			const members = list(properties(target).policyDefinitions).map(record)
				.filter((member) => findReference(source, member.policyDefinitionId)?.name === entity.name);
			if (!members.length) continue;
			const initiativeParameters = assignmentParameters(assignment, target);
			effect = [...new Set(members.map((member) => {
				const parameters = {
					...parameterValues(entity),
					...Object.fromEntries(Object.entries(record(member.parameters)).map(([key, value]) =>
						[key, resolveValue(record(value).value, initiativeParameters)]))
				};
				for (const [name, value] of Object.entries(parameters)) {
					memberNotes.push(`${memberKey(member)} — ${label(name)}: ${readableValue(value)}`);
				}
				if (member.definitionVersion !== undefined) memberNotes.push(`${memberKey(member)} version selection: ${readableValue(member.definitionVersion)}.`);
				if (!matchesVersion(entity, member.definitionVersion)) return 'Effect unresolved — member version selection does not resolve to the bundled definition';
				return policyEffect(entity, parameters);
			}))].join('; ');
		} else continue;
		const props = properties(assignment);
		const scope = scopeFor(source, assignment);
		const notes: string[] = [];
		if (list(props.resourceSelectors).length) notes.push('Resource selectors restrict applicability; review the assignment source.');
		if (list(props.overrides).length) notes.push('Assignment overrides require source review.');
		if (props.definitionVersion !== undefined) notes.push(`Assignment version selection: ${readableValue(props.definitionVersion)}.`);
		if (target && !matchesVersion(target, props.definitionVersion)) {
			effect = 'Effect unresolved — assignment version selection does not resolve to the bundled definition';
			notes.push('The selected version cannot be verified against the bundled definition.');
		}
		if (list(props.overrides).length) {
			effect = 'Effect requires source review — assignment overrides are present';
		}
		const exclusions = strings(props.notScopes);
		results.push({
			assignmentId: assignment.name,
			name: displayName(assignment),
			definitionId: text(props.policyDefinitionId) ?? '',
			definitionTitle: target ? displayName(target) : referenceName(props.policyDefinitionId),
			definitionVersion: target ? version(target) : undefined,
			definition: target
				? `${displayName(target)} (${target.name}${version(target) ? `, version ${version(target)}` : ''})`
				: `${referenceName(props.policyDefinitionId)} — definition unavailable`,
			scopes: [
				...scope.scopes,
				...exclusions.map((scope) => `Excluded scope: ${scope}`)
			],
			effect,
			enforcement: text(props.enforcementMode) === 'DoNotEnforce'
				? 'DoNotEnforce — policy effects are not enforced by this assignment'
				: text(props.enforcementMode) === 'Default' || props.enforcementMode === undefined
					? 'Default — normal policy enforcement'
					: `Enforcement requires review: ${readableValue(props.enforcementMode)}`,
			parameters: resolvedParameters
				? Object.entries(resolvedParameters).map(([key, value]) => `${label(key)}: ${readableValue(value)}`)
				: entity.kind === 'policy' ? memberNotes
					: Object.entries(record(props.parameters)).map(([key, value]) =>
						`${label(key)}: ${readableValue(record(value).value)}`),
			notes,
			sources: [
				{ label: 'Assignment source', url: sourceLink(sha, assignment.path) },
				...(target?.kind === 'initiative' ? [{ label: 'Initiative source', url: sourceLink(sha, target.path) }] : []),
				...scope.evidence.map((item) => ({ label: `${label(item.kind)}: ${item.name}`, url: sourceLink(sha, item.path) }))
			]
		});
	}
	return results.sort((a, b) => stable(a).localeCompare(stable(b)));
}
function label(key: string): string {
	return key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]/g, ' ');
}
function parameterFacts(before: RecordValue, after: RecordValue): string[] {
	const facts: string[] = [];
	for (const name of [...new Set([...Object.keys(before), ...Object.keys(after)])].sort()) {
		const old = record(before[name]);
		const next = record(after[name]);
		const title = text(record(next.metadata).displayName) ?? text(record(old.metadata).displayName) ?? label(name);
		if (!(name in before)) {
			facts.push(`Parameter added: ${title}. Default: ${readableValue(next.defaultValue)}.`);
		} else if (!(name in after)) {
			facts.push(`Parameter removed: ${title}.`);
		} else {
			if (!equal(old.defaultValue, next.defaultValue)) {
				facts.push(`${title} default changed from ${readableValue(old.defaultValue)} to ${readableValue(next.defaultValue)}.`);
			}
			if (!equal(old.allowedValues, next.allowedValues)) {
				facts.push(`${title} allowed values changed from ${readableValue(old.allowedValues)} to ${readableValue(next.allowedValues)}.`);
			}
			if (!equal(old.type, next.type)) facts.push(`${title} type changed from ${readableValue(old.type)} to ${readableValue(next.type)}.`);
			if (!equal(old.metadata, next.metadata)) facts.push(`${title} parameter documentation or metadata changed.`);
			const constraints = (value: RecordValue) => Object.fromEntries(Object.entries(value)
				.filter(([key]) => !['defaultValue', 'allowedValues', 'type', 'metadata'].includes(key)));
			if (!equal(constraints(old), constraints(next))) {
				facts.push(`${title} parameter constraints changed; review the source for details.`);
			}
		}
	}
	return facts;
}
function condition(value: unknown, budget: { remaining: number; unsupported: boolean }): string {
	if (--budget.remaining < 0) {
		budget.unsupported = true;
		return 'additional conditions (see source)';
	}
	const rule = record(value);
	for (const [key, joiner] of [['allOf', ' AND '], ['anyOf', ' OR ']]) {
		if (Array.isArray(rule[key])) {
			if (Object.keys(rule).length > 1 || list(rule[key]).length === 0) budget.unsupported = true;
			return `(${list(rule[key]).map((item) => condition(item, budget)).join(joiner)})`;
		}
	}
	if (rule.not) {
		if (Object.keys(rule).length > 1) budget.unsupported = true;
		return `NOT (${condition(rule.not, budget)})`;
	}
	let subject = text(rule.field);
	if (subject?.startsWith('[')) {
		budget.unsupported = true;
		subject = 'an expression-based field (see source)';
	}
	if (subject === 'type') subject = 'resource type';
	if (subject === 'name') subject = 'resource name';
	if (subject === 'location') subject = 'resource location';
	if (rule.count) {
		const count = record(rule.count);
		if (!text(count.field) || Object.keys(count).some((key) => !['field', 'where'].includes(key))) budget.unsupported = true;
		subject = `the number of ${text(count.field) ?? 'items'}${count.where ? ` matching ${condition(count.where, budget)}` : ''}`;
	}
	const operators: Record<string, string> = {
		equals: 'equals', notEquals: 'does not equal', in: 'is one of', notIn: 'is not one of',
		contains: 'contains', notContains: 'does not contain', like: 'matches pattern', notLike: 'does not match pattern',
		match: 'matches', notMatch: 'does not match', greater: 'is greater than', greaterOrEquals: 'is at least',
		less: 'is less than', lessOrEquals: 'is at most', exists: 'exists'
	};
	if (subject) {
		const operator = Object.keys(operators).find((key) => key in rule);
		if (operator) {
			if (Object.keys(rule).some((key) => !['field', 'count', operator].includes(key))) budget.unsupported = true;
			if (operator === 'exists') {
				const exists = String(rule.exists).toLowerCase();
				if (exists !== 'true' && exists !== 'false') {
					budget.unsupported = true;
					return `${subject} has an expression-based existence test (see source)`;
				}
				return `${subject} ${exists === 'true' ? 'exists' : 'does not exist'}`;
			}
			const operand = rule[operator];
			if (typeof operand === 'string' && operand.startsWith('[')) {
				const parameter = /^\[parameters\(['"]([^'"]+)['"]\)\]$/i.exec(operand);
				if (parameter) return `${subject} ${operators[operator]} the configured ${label(parameter[1])}`;
				budget.unsupported = true;
				return `${subject} ${operators[operator]} an expression requiring source review`;
			}
			return `${subject} ${operators[operator]} ${readableValue(operand)}`;
		}
	}
	budget.unsupported = true;
	return 'a condition requiring source review';
}
function policyFacts(before: Entity | undefined, after: Entity | undefined, warnings: string[]): string[] {
	const old = properties(before);
	const next = properties(after);
	const entity = after ?? before!;
	const facts = [`Default effect: ${policyEffect(entity)}.`];
	if (!before || !after) return facts;
	facts.push(...parameterFacts(record(old.parameters), record(next.parameters)));
	const oldRule = record(old.policyRule);
	const nextRule = record(next.policyRule);
	if (!equal(oldRule.if, nextRule.if)) {
		const budget = { remaining: 50, unsupported: false };
		facts.push(`Previously matched when ${condition(oldRule.if, budget)}.`);
		facts.push(`Now matches when ${condition(nextRule.if, budget)}.`);
		if (budget.unsupported) warnings.push('Some policy conditions could not be translated. Review the linked policy-rule changes before drawing conclusions.');
	}
	if (!equal(oldRule.then, nextRule.then)) {
		facts.push(`Policy action changed. Previous default: ${policyEffect(before)}. New default: ${policyEffect(after)}.`);
		const oldThen = record(oldRule.then);
		const newThen = record(nextRule.then);
		if (!equal(oldThen.details, newThen.details)) {
			facts.push('The action details changed, including deployment, existence checks, or property operations. Review the source to understand those details.');
			warnings.push('Action details are not automatically interpreted; no deployment outcome is inferred.');
		}
		if (!equal(
			Object.fromEntries(Object.entries(oldThen).filter(([key]) => !['effect', 'details'].includes(key))),
			Object.fromEntries(Object.entries(newThen).filter(([key]) => !['effect', 'details'].includes(key)))
		)) warnings.push('Additional policy action properties changed and require source review.');
	}
	if (!equal(old.mode, next.mode)) facts.push(`Evaluation mode changed from ${readableValue(old.mode)} to ${readableValue(next.mode)}.`);
	if (equal(oldRule, nextRule)) facts.push('The policy evaluation rule is unchanged.');
	return facts;
}
function memberKey(member: RecordValue): string {
	return text(member.policyDefinitionReferenceId) ?? text(member.policyDefinitionId) ?? 'Unnamed member';
}
function initiativeFacts(before: Entity | undefined, after: Entity | undefined, source: Inventory, warnings: string[]): string[] {
	const old = properties(before);
	const next = properties(after);
	const oldMembers = new Map(list(old.policyDefinitions).map(record).map((member) => [memberKey(member), member]));
	const newMembers = new Map(list(next.policyDefinitions).map(record).map((member) => [memberKey(member), member]));
	const facts = before && after
		? parameterFacts(record(old.parameters), record(next.parameters))
		: [`Contains ${(after ? newMembers : oldMembers).size} member policies; each can have its own effect.`];
	for (const key of [...new Set([...oldMembers.keys(), ...newMembers.keys()])].sort()) {
		const previous = oldMembers.get(key);
		const current = newMembers.get(key);
		const member = current ?? previous!;
		const definition = findReference(source, member.policyDefinitionId);
		const title = definition ? displayName(definition) : `${label(key)} (definition not included)`;
		if (!previous) facts.push(`Policy added to initiative: ${title} (${key}).`);
		else if (!current) facts.push(`Policy removed from initiative: ${title} (${key}).`);
		else {
			if (!equal(previous.policyDefinitionId, current.policyDefinitionId)) {
				facts.push(`Member ${key} now references ${title} instead of ${referenceName(previous.policyDefinitionId)}.`);
			}
			if (!equal(previous.definitionVersion, current.definitionVersion)) {
				facts.push(`${title} version selection changed from ${readableValue(previous.definitionVersion)} to ${readableValue(current.definitionVersion)}.`);
			}
			if (!equal(previous.parameters, current.parameters)) {
				for (const name of [...new Set([...Object.keys(record(previous.parameters)), ...Object.keys(record(current.parameters))])]) {
					const oldValue = record(record(previous.parameters)[name]).value;
					const newValue = record(record(current.parameters)[name]).value;
					if (!equal(oldValue, newValue)) facts.push(`${title}: ${label(name)} binding changed from ${readableValue(oldValue)} to ${readableValue(newValue)}.`);
				}
			}
			if (!equal(previous.groupNames, current.groupNames)) facts.push(`${title} policy grouping changed.`);
		}
		if (current && !definition && (!previous || !equal(previous, current))) {
			warnings.push(`${title}: its purpose, actual version, and policy rule cannot be verified from this source. Referenced ID: ${referenceName(member.policyDefinitionId)}.`);
		}
		if (!previous && current && definition?.kind === 'policy') {
			const parameters = {
				...parameterValues(definition),
				...Object.fromEntries(Object.entries(record(current.parameters)).map(([name, value]) =>
					[name, resolveValue(record(value).value, parameterValues(after!))]))
			};
			facts.push(matchesVersion(definition, current.definitionVersion)
				? `${title}: ${policyEffect(definition, parameters)} (initiative default; assignments can override).`
				: `${title}: effect unresolved — member version selection does not resolve to the bundled definition.`);
		}
	}
	return facts;
}
function entityFacts(before: Entity | undefined, after: Entity | undefined, source: Inventory, warnings: string[]): string[] {
	const entity = after ?? before!;
	const old = properties(before);
	const next = properties(after);
	if (entity.kind === 'policy') return policyFacts(before, after, warnings);
	if (entity.kind === 'initiative') return initiativeFacts(before, after, source, warnings);
	if (entity.kind === 'assignment') {
		const facts: string[] = [];
		if (!before || !after || !equal(old.policyDefinitionId, next.policyDefinitionId)) {
			const id = (after ? next : old).policyDefinitionId;
			const target = findReference(source, id);
			const previousTarget = before ? referenceName(old.policyDefinitionId) : undefined;
			facts.push(`${previousTarget && after ? `Assignment changed from ${previousTarget} to` : 'Assigns'} ${target ? `${displayName(target)} (${target.name}${version(target) ? `, version ${version(target)}` : ''})` : referenceName(id)}${target ? '' : ' (definition unavailable in this release)'}.`);
		}
		for (const name of [...new Set([...Object.keys(record(old.parameters)), ...Object.keys(record(next.parameters))])]) {
			const a = record(record(old.parameters)[name]).value;
			const b = record(record(next.parameters)[name]).value;
			if (!equal(a, b)) facts.push(`${label(name)} assignment value changed from ${readableValue(a)} to ${readableValue(b)}.`);
		}
		if (!equal(old.definitionVersion, next.definitionVersion)) facts.push(`Version selection changed from ${readableValue(old.definitionVersion)} to ${readableValue(next.definitionVersion)}.`);
		if (!equal(old.overrides, next.overrides)) warnings.push('Assignment overrides changed; review the source for their selectors and effects.');
		if (!equal(old.resourceSelectors, next.resourceSelectors)) warnings.push('Resource selectors changed; review the source to determine which resources are selected.');
		return facts;
	}
	if (entity.kind === 'archetype') {
		const facts: string[] = [];
		for (const key of ['policy_assignments', 'policy_definitions', 'policy_set_definitions', 'role_definitions']) {
			const a = strings(before?.value[key]);
			const b = strings(after?.value[key]);
			const added = b.filter((name) => !a.includes(name));
			const removed = a.filter((name) => !b.includes(name));
			if (added.length) facts.push(`${label(key)} added: ${added.join(', ')}.`);
			if (removed.length) facts.push(`${label(key)} removed: ${removed.join(', ')}.`);
		}
		return facts;
	}
	if (entity.kind === 'architecture') {
		const a = new Map(list(before?.value.management_groups).map(record).map((group) => [text(group.id), group]));
		const b = new Map(list(after?.value.management_groups).map(record).map((group) => [text(group.id), group]));
		return [...new Set([...a.keys(), ...b.keys()])].flatMap((id) => {
			const oldGroup = a.get(id);
			const newGroup = b.get(id);
			if (equal(oldGroup, newGroup)) return [];
			const group = newGroup ?? oldGroup!;
			const title = text(group.display_name) ?? id;
			if (!oldGroup) return [`Management group added: ${title}. Archetypes: ${strings(group.archetypes).join(', ') || 'none'}.`];
			if (!newGroup) return [`Management group removed: ${title}.`];
			const facts = [`Management group ${title} changed.`];
			if (!equal(oldGroup.archetypes, newGroup.archetypes)) facts.push(`Archetypes changed from ${readableValue(oldGroup.archetypes)} to ${readableValue(newGroup.archetypes)}.`);
			if (!equal(oldGroup.parent_id, newGroup.parent_id)) facts.push(`Parent changed from ${readableValue(oldGroup.parent_id)} to ${readableValue(newGroup.parent_id)}.`);
			return facts;
		});
	}
	warnings.push('This library configuration is not yet semantically interpreted. Review the linked source; no behavioral impact is inferred.');
	return [];
}
function sourceLink(sha: string, path: string): string {
	return `${UPSTREAM}/blob/${sha}/${path.split('/').map(encodeURIComponent).join('/')}`;
}
function contextSummary(before: PolicyAssignmentContext[], after: PolicyAssignmentContext[], kind: ChangeKind): string {
	const unchanged = `The ${kind} definition is unchanged.`;
	const replaced = after.find((context) => before.some((old) => old.assignmentId === context.assignmentId && old.definitionId !== context.definitionId));
	if (replaced) return `Assignment now uses ${replaced.definitionTitle}${replaced.definitionVersion ? `, version ${replaced.definitionVersion}` : ''}. ${unchanged}`;
	if (!equal(before.map((item) => item.scopes), after.map((item) => item.scopes))) {
		return `Library assignment scopes changed. ${unchanged}`;
	}
	if (!equal(before.map((item) => item.effect), after.map((item) => item.effect))) {
		return `Configured assignment effects changed. ${unchanged}`;
	}
	if (!equal(before.map((item) => item.enforcement), after.map((item) => item.enforcement))) {
		return `Assignment enforcement changed. ${unchanged}`;
	}
	return `Assignment parameters or version selections changed. ${unchanged}`;
}

export function analyzeReleases(
	beforeFiles: ReleaseFiles, afterFiles: ReleaseFiles, fromSha: string, toSha: string
): { changes: ReleaseChange[]; sourceFilesChanged: number } {
	const before = inventory(beforeFiles);
	const after = inventory(afterFiles);
	const changes: ReleaseChange[] = [];
	const changedPaths = new Set([...beforeFiles.keys(), ...afterFiles.keys()].filter((path) => beforeFiles.get(path) !== afterFiles.get(path)));
	for (const id of [...new Set([...before.entities.keys(), ...after.entities.keys()])].sort()) {
		const previous = before.entities.get(id);
		const current = after.entities.get(id);
		const entity = current ?? previous!;
		const hasContexts = ['policy', 'initiative', 'assignment'].includes(entity.kind);
		const assignmentsBefore = previous && hasContexts ? contexts(before, previous, fromSha) : [];
		const assignmentsAfter = current && hasContexts ? contexts(after, current, toSha) : [];
		const contextChanged = !equal(
			assignmentsBefore.map(assignmentContextFacts),
			assignmentsAfter.map(assignmentContextFacts)
		);
		if (previous && current && equal(previous.value, current.value) && !contextChanged && previous.path === current.path) continue;
		const status = !previous ? 'added' : !current ? 'removed' : 'modified';
		const deprecated = current && ['policy', 'initiative'].includes(current.kind)
			&& record(properties(current).metadata).deprecated === true;
		const deprecationOnly = deprecated && previous && current && isDeprecationOnly(previous, current);
		const warnings: string[] = [];
		const facts = entityFacts(previous, current, current ? after : before, warnings);
		const beforeVersion = version(previous);
		const afterVersion = version(current);
		if (beforeVersion !== afterVersion && previous && current) {
			facts.unshift(`Version changed from ${beforeVersion ?? 'not specified'} to ${afterVersion ?? 'not specified'}.`);
		}
		if (previous && current && !equal(properties(previous).description, properties(current).description)) facts.push('The policy purpose or description changed.');
		if (previous && current && !equal(properties(previous).displayName, properties(current).displayName)) {
			facts.push(`Display name changed from ${displayName(previous)} to ${displayName(current)}.`);
		}
		if (previous && current && !equal(properties(previous).metadata, properties(current).metadata)) facts.push('Release metadata changed.');
		if (previous && current && hasContexts) {
			const supported = entity.kind === 'policy'
				? ['displayName', 'description', 'metadata', 'version', 'parameters', 'policyRule', 'mode']
				: entity.kind === 'initiative'
					? ['displayName', 'description', 'metadata', 'version', 'parameters', 'policyDefinitions']
					: ['displayName', 'description', 'metadata', 'parameters', 'policyDefinitionId', 'definitionVersion',
						'scope', 'notScopes', 'enforcementMode', 'overrides', 'resourceSelectors'];
			const other = (value: RecordValue) => Object.fromEntries(Object.entries(value).filter(([key]) => !supported.includes(key)));
			if (!equal(other(properties(previous)), other(properties(current)))) {
				warnings.push('Additional definition properties changed and require source review.');
			}
		}
		if (previous && current && previous.path !== current.path) facts.push('The source file was relocated; the library identity is unchanged.');
		if (contextChanged && previous && current) facts.push('Library assignment context changed; compare the previous and new scopes, effects, and enforcement below.');
		if (hasContexts && !assignmentsAfter.length && current) warnings.push('No assignment was found in this release. Adding a definition alone does not assign or enforce it.');
		if (hasContexts) warnings.push('Scopes describe direct library assignments. Azure Policy can inherit to descendants; this is not a report of your deployed environment.');
		if (!facts.length) warnings.push('Other properties changed; automatic behavioral interpretation is unavailable. Review the source.');
		const title = displayName(entity);
		const kindLabel = entity.kind === 'initiative' ? 'Policy initiative' : `${entity.kind[0].toUpperCase()}${label(entity.kind).slice(1)}`;
		const summary = status === 'added' ? `New ${kindLabel.toLowerCase()} in this release.`
			: status === 'removed' ? `${kindLabel} removed from this release.`
			: deprecationOnly ? `${kindLabel} marked as deprecated; its rules and parameters are unchanged.`
			: beforeVersion !== afterVersion ? `Version ${beforeVersion ?? 'not specified'} to ${afterVersion ?? 'not specified'}.`
			: contextChanged && previous && current && equal(previous.value, current.value)
				? contextSummary(assignmentsBefore, assignmentsAfter, entity.kind)
				: `${kindLabel} updated in this release.`;
		const sources = [
			...(previous ? [{ label: 'Previous definition', url: sourceLink(fromSha, previous.path) }] : []),
			...(current ? [{ label: 'New definition', url: sourceLink(toSha, current.path) }] : []),
			{ label: 'View source changes on GitHub', url: `${UPSTREAM}/compare/${fromSha}...${toSha}#diff-${createHash('sha256').update(entity.path).digest('hex')}` }
		];
		changes.push({ id, kind: entity.kind, title, status, summary,
			...(deprecated ? { deprecated: true } : {}),
			...(deprecationOnly ? { deprecationOnly: true } : {}),
			description: text(properties(entity).description),
			beforeVersion, afterVersion, facts, warnings: [...new Set(warnings)],
			assignmentsBefore, assignmentsAfter, sources });
	}
	for (const path of changedPaths) {
		if (path.endsWith('.json') || /^readme(?:\.[^.]+)?$/i.test(path.split('/').at(-1) ?? '')) continue;
		changes.push({
			id: path, kind: kindFor(path), title: path.split('/').at(-1) ?? path,
			status: !beforeFiles.has(path) ? 'added' : !afterFiles.has(path) ? 'removed' : 'modified',
			summary: 'Supporting library documentation or content changed.',
			facts: [], warnings: ['This content is not semantically interpreted. Read the source for details.'],
			assignmentsBefore: [], assignmentsAfter: [],
			sources: [
				...(beforeFiles.has(path) ? [{ label: 'Previous source', url: sourceLink(fromSha, path) }] : []),
				...(afterFiles.has(path) ? [{ label: 'New source', url: sourceLink(toSha, path) }] : [])
			]
		});
	}
	const priority: ChangeKind[] = ['policy', 'initiative', 'assignment', 'archetype', 'architecture', 'role', 'configuration', 'documentation'];
	changes.sort((a, b) => priority.indexOf(a.kind) - priority.indexOf(b.kind) || a.title.localeCompare(b.title));
	return { changes, sourceFilesChanged: changedPaths.size };
}

export function summarizeChanges(changes: ReleaseChange[]) {
	const totals = { changed: changes.length, added: 0, modified: 0, removed: 0 };
	for (const change of changes) totals[change.status]++;
	const policyCount = changes.filter((change) => change.kind === 'policy').length;
	const initiativeCount = changes.filter((change) => change.kind === 'initiative').length;
	return {
		totals,
		summary: changes.length
			? `Updates affecting ${policyCount} polic${policyCount === 1 ? 'y' : 'ies'} and ${initiativeCount} initiative${initiativeCount === 1 ? '' : 's'}, plus ${changes.length - policyCount - initiativeCount} other library changes.`
			: 'No semantic library changes were found between these releases.'
	};
}
