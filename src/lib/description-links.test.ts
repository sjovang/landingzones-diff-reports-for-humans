import { describe, expect, it } from 'vitest';
import { descriptionParts } from './description-links.js';

describe('description hyperlinks', () => {
	it('preserves text and detects HTTP and HTTPS links', () => {
		expect(descriptionParts('See https://example.com/policy and http://example.org.')).toEqual([
			{ text: 'See ' }, { text: 'https://example.com/policy', href: 'https://example.com/policy' },
			{ text: ' and ' }, { text: 'http://example.org', href: 'http://example.org/' }, { text: '.' }
		]);
	});

	it('excludes sentence punctuation and enclosing parentheses, retaining URL parentheses', () => {
		const text = 'See (https://example.com/policy_(one)), next.';
		const parts = descriptionParts(text);
		expect(parts.find((part) => part.href)?.text).toBe('https://example.com/policy_(one)');
		expect(parts.map((part) => part.text).join('')).toBe(text);
	});

	it('leaves HTML, unsafe protocols, and invalid URLs as ordinary text', () => {
		const text = '<script>alert(1)</script> javascript:alert(1) https://.';
		expect(descriptionParts(text).every((part) => !part.href)).toBe(true);
		expect(descriptionParts(text).map((part) => part.text).join('')).toBe(text);
		expect(descriptionParts('')).toEqual([]);
	});
});
