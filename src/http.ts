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
	/**
	 * Check the HTTPS certificate. Off in the home network, where the box serves one it signed
	 * itself; on over the internet, where MyFRITZ! names get a valid one.
	 */
	verifyCertificate?: boolean
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

/** The box answered over HTTPS with a certificate that does not check out. */
export class CertificateError extends HttpTransportError {
	constructor(host: string, reason: string) {
		super(
			`The HTTPS certificate of ${host} is not trusted (${reason}). MyFRITZ! names get a valid ` +
				'certificate; for another name or an IP address, tick "Accept the certificate the box signed ' +
				'itself" in the connection settings if the network can be trusted',
		)
		this.name = 'CertificateError'
	}
}

/** Error codes of node:tls for a certificate that failed the check. */
const CERTIFICATE_CODES =
	/^(?:DEPTH_ZERO_SELF_SIGNED_CERT|SELF_SIGNED_CERT_IN_CHAIN|UNABLE_TO_(?:VERIFY_LEAF_SIGNATURE|GET_ISSUER_CERT(?:_LOCALLY)?)|CERT_(?:HAS_EXPIRED|NOT_YET_VALID|UNTRUSTED|REJECTED)|ERR_TLS_CERT_ALTNAME_INVALID)$/

/**
 * One HTTP round trip.
 *
 * Built on node:http/node:https rather than fetch, because in the home network the FRITZ!Box
 * serves HTTPS with a certificate it signed itself, and fetch offers no per-request way to accept
 * that without a dependency. Every status code resolves; deciding what counts as an error is up to the caller,
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
				...(options.https ? { rejectUnauthorized: options.verifyCertificate === true } : {}),
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
		req.on('error', (err: NodeJS.ErrnoException) => {
			if (err instanceof HttpTransportError) reject(err)
			else if (CERTIFICATE_CODES.test(err.code ?? '')) reject(new CertificateError(options.host, err.code ?? ''))
			else reject(new HttpTransportError(err.message))
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
		.replace(/&#(\d+);/g, (raw, code: string) => fromCodePoint(Number(code), raw))
		.replace(/&#x([0-9a-fA-F]+);/g, (raw, code: string) => fromCodePoint(parseInt(code, 16), raw))
		.replace(/&amp;/g, '&')
}

/** A character for a numeric reference; one out of range stays as written instead of failing the whole text. */
function fromCodePoint(code: number, raw: string): string {
	return Number.isInteger(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : raw
}

export function encodeXmlEntities(text: string): string {
	return text
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&apos;')
}
