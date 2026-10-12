export function descriptionParts(text: string): Array<{ text: string; href?: string }> {
	const parts: Array<{ text: string; href?: string }> = [];
	let offset = 0;
	for (const match of text.matchAll(/https?:\/\/[^\s<>"']+/gi)) {
		const start = match.index;
		let url = match[0].replace(/[.,;:!?]+$/, '');
		while (url.endsWith(')') && (url.match(/\)/g)?.length ?? 0) > (url.match(/\(/g)?.length ?? 0)) {
			url = url.slice(0, -1);
		}
		if (start > offset) parts.push({ text: text.slice(offset, start) });
		try {
			const parsed = new URL(url);
			if (!parsed.hostname) throw new Error('Missing hostname');
			parts.push({ text: url, href: parsed.href });
		} catch {
			parts.push({ text: url });
		}
		offset = start + url.length;
	}
	if (offset < text.length) parts.push({ text: text.slice(offset) });
	return parts;
}
