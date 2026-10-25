import { request as httpRequest, type IncomingHttpHeaders } from 'node:http'
import { request as httpsRequest } from 'node:https'

/** What a request returned, whatever the status code. */
export interface HttpResponse {
	status: number
	headers: IncomingHttpHeaders
	body: string
}

export interface HttpRequestOptions {
	host: string
	port: number
	https: boolean
	method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
	path: string
	headers?: Record<string, string>
	body?: string
	timeout: number
}

/** What an observer learns about a request: never headers or bodies, so never credentials. */
export interface HttpObservation {
	method: string
	host: string
	port: number
	path: string
	status?: number
	ms: number
	error?: string
}

let observer: ((observation: HttpObservation) => void) | undefined

/** Lets the diagnostics see each request. One module process serves one connection, so one is enough. */
export function setHttpObserver(fn: ((observation: HttpObservation) => void) | undefined): void {
	observer = fn
}

/** A failure to get any answer at all: refused, unreachable, timed out. */
export class HttpTransportError extends Error {
	constructor(message: string) {
		super(message)
		this.name = 'HttpTransportError'
	}
}

/**
 * One HTTP round trip.
 *
 * Built on node:http/node:https rather than fetch, because the FRITZ!Box serves HTTPS with a
 * certificate it signed itself, and fetch offers no per-request way to accept that without a
 * dependency. Every status code resolves; deciding what counts as an error is up to the caller,
 * since a 401 is a normal step of the digest handshake.
 */
export async function httpCall(options: HttpRequestOptions): Promise<HttpResponse> {
	const started = Date.now()
	const note = (status?: number, error?: string): void =>
		observer?.({
			method: options.method,
			host: options.host,
			port: options.port,
			path: options.path,
			ms: Date.now() - started,
			...(status !== undefined ? { status } : {}),
			...(error ? { error } : {}),
		})
	try {
		const response = await send(options)
		note(response.status)
		return response
	} catch (error) {
		note(undefined, error instanceof Error ? error.message : String(error))
		throw error
	}
}

async function send(options: HttpRequestOptions): Promise<HttpResponse> {
	const headers: Record<string, string> = { ...options.headers }
	if (options.body !== undefined) headers['Content-Length'] = String(Buffer.byteLength(options.body))

	return new Promise<HttpResponse>((resolve, reject) => {
		const doRequest = options.https ? httpsRequest : httpRequest
		const req = doRequest(
			{
				// A bare IPv6 literal must not be wrapped in brackets here; node does that itself.
				host: options.host,
				port: options.port,
				path: options.path,
				method: options.method,
				headers,
				...(options.https ? { rejectUnauthorized: false } : {}),
			},
			(res) => {
				const chunks: Buffer[] = []
				res.on('data', (chunk: Buffer) => chunks.push(chunk))
				res.on('end', () => {
					resolve({
						status: res.statusCode ?? 0,
						headers: res.headers,
						body: Buffer.concat(chunks).toString('utf8'),
					})
				})
				res.on('error', (err) => reject(new HttpTransportError(err.message)))
			},
		)

		req.setTimeout(options.timeout, () => {
			req.destroy(new HttpTransportError(`${options.method} ${options.path} timed out after ${options.timeout} ms`))
		})
		req.on('error', (err) => {
			reject(err instanceof HttpTransportError ? err : new HttpTransportError(err.message))
		})

		if (options.body !== undefined) req.write(options.body)
		req.end()
	})
}

/** Reads the text of the first element with this tag name, ignoring any namespace prefix. */
export function xmlValue(xml: string, tag: string): string | undefined {
	const match = new RegExp(`<(?:[\\w-]+:)?${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[\\w-]+:)?${tag}>`).exec(xml)
	if (!match) {
		// An empty element written as <Tag/> still counts as present.
		if (new RegExp(`<(?:[\\w-]+:)?${tag}(?:\\s[^>]*)?/>`).test(xml)) return ''
		return undefined
	}
	return decodeXmlEntities(match[1] ?? '')
}

export function decodeXmlEntities(text: string): string {
	return text
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&apos;/g, "'")
		.replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
		.replace(/&#x([0-9a-fA-F]+);/g, (_, code: string) => String.fromCodePoint(parseInt(code, 16)))
		.replace(/&amp;/g, '&')
}

export function encodeXmlEntities(text: string): string {
	return text
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&apos;')
}
