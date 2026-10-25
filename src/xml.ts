import { decodeXmlEntities } from './http.js'

/** One element of a parsed XML document. */
export interface XmlElement {
	name: string
	attributes: Record<string, string>
	children: XmlElement[]
	/** The text directly inside the element, trimmed. */
	text: string
}

/**
 * A small, forgiving XML parser for the documents the FRITZ!Box sends: elements, attributes,
 * text, self-closing tags and entities. Declarations, comments and CDATA are skipped. A closing
 * tag that does not match is tolerated, as AVM's own examples contain such mistakes; it closes
 * the elements opened since the matching one, or is ignored when nothing matches.
 */
export function parseXml(xml: string): XmlElement {
	const root: XmlElement = { name: '#document', attributes: {}, children: [], text: '' }
	const stack: XmlElement[] = [root]
	const texts: string[][] = [[]]
	const tag =
		/<(\/?)([A-Za-z_][\w.:-]*)((?:\s+[^\s=>/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>|<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[([\s\S]*?)\]\]>|<![^>]*>/g
	let last = 0

	const addText = (text: string): void => {
		texts[texts.length - 1]?.push(text)
	}
	const close = (index: number): void => {
		while (stack.length > index) {
			const element = stack.pop()
			const parts = texts.pop() ?? []
			if (element) element.text = decodeXmlEntities(parts.join('')).trim()
		}
	}

	for (const match of xml.matchAll(tag)) {
		addText(xml.slice(last, match.index))
		last = (match.index ?? 0) + match[0].length
		if (match[5] !== undefined) {
			addText(match[5])
			continue
		}
		const name = match[2]
		if (!name) continue
		if (match[1] === '/') {
			for (let i = stack.length - 1; i > 0; i--) {
				if (stack[i]?.name === name) {
					close(i)
					break
				}
			}
			continue
		}
		const element: XmlElement = { name, attributes: parseAttributes(match[3] ?? ''), children: [], text: '' }
		stack[stack.length - 1]?.children.push(element)
		if (match[4] !== '/') {
			stack.push(element)
			texts.push([])
		}
	}
	addText(xml.slice(last))
	close(1)
	return root
}

function parseAttributes(source: string): Record<string, string> {
	const attributes: Record<string, string> = {}
	for (const match of source.matchAll(/([^\s=>/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) {
		const key = match[1]
		if (key) attributes[key] = decodeXmlEntities(match[2] ?? match[3] ?? match[4] ?? '')
	}
	return attributes
}

/** The first child with this name, if any. */
export function child(element: XmlElement | undefined, name: string): XmlElement | undefined {
	return element?.children.find((entry) => entry.name === name)
}

/** All children with this name. */
export function children(element: XmlElement | undefined, name: string): XmlElement[] {
	return element?.children.filter((entry) => entry.name === name) ?? []
}

/** The text of a child, or undefined when the child is missing or empty. */
export function childText(element: XmlElement | undefined, name: string): string | undefined {
	const text = child(element, name)?.text
	return text === undefined || text === '' ? undefined : text
}

/** The number in a child, or undefined when it is missing, empty or not a number. */
export function childNumber(element: XmlElement | undefined, name: string): number | undefined {
	const text = childText(element, name)
	if (text === undefined) return undefined
	const number = Number(text)
	return Number.isFinite(number) ? number : undefined
}

/** A plain object view of an element, for the diagnostics report. */
export function xmlToJson(element: XmlElement): unknown {
	const result: Record<string, unknown> = { ...element.attributes }
	for (const entry of element.children) {
		const value = entry.children.length > 0 || Object.keys(entry.attributes).length > 0 ? xmlToJson(entry) : entry.text
		const existing = result[entry.name]
		if (existing === undefined) result[entry.name] = value
		else if (Array.isArray(existing)) existing.push(value)
		else result[entry.name] = [existing, value]
	}
	if (element.children.length === 0 && element.text !== '' && Object.keys(element.attributes).length > 0) {
		result.text = element.text
	}
	return result
}
