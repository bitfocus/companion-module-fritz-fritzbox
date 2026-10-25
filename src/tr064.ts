import { createHash, randomBytes } from 'node:crypto'
import { encodeXmlEntities, httpCall, xmlValue, type HttpResponse } from './http.js'

/** The plain TR-064 port. The HTTPS port is announced by the box itself, see GetSecurityPort. */
export const TR064_HTTP_PORT = 49000

/** One service as announced in tr64desc.xml. */
export interface Tr064Service {
	serviceType: string
	/** The last part of the serviceId, e.g. WLANConfiguration2. Unique, unlike the serviceType. */
	id: string
	controlUrl: string
}

/** A SOAP fault: the box understood the request and refused it. */
export class Tr064Fault extends Error {
	readonly code: number
	readonly description: string

	constructor(action: string, code: number, description: string) {
		super(`${action} failed: UPnP error ${code} ${description}`)
		this.name = 'Tr064Fault'
		this.code = code
		this.description = description
	}

	/** The user lacks the right this action needs. */
	get isMissingRight(): boolean {
		return this.code === 606
	}

	/** The action does not exist on this box or firmware. */
	get isUnknownAction(): boolean {
		return this.code === 401
	}
}

/** The box refused the credentials. */
export class Tr064AuthError extends Error {
	constructor(message: string) {
		super(message)
		this.name = 'Tr064AuthError'
	}
}

export interface Tr064Options {
	host: string
	port: number
	https: boolean
	username: string
	password: string
	timeout: number
	/** tr64desc.xml for TR-064, igddesc.xml for the unauthenticated UPnP IGD services. */
	descriptionPath?: string
	/**
	 * Put in front of every path. Over the internet TR-064 shares the HTTPS port of the web
	 * interface and lives below /tr064, so /upnp/control/deviceinfo becomes
	 * /tr064/upnp/control/deviceinfo.
	 */
	pathPrefix?: string
}

/** The path prefix TR-064 uses on the remote access port. */
export const REMOTE_TR064_PREFIX = '/tr064'

interface DigestChallenge {
	realm: string
	nonce: string
	qop: string | undefined
	opaque: string | undefined
	algorithm: string | undefined
	count: number
}

const md5 = (text: string): string => createHash('md5').update(text, 'utf8').digest('hex')

/** Reads the quoted or bare parameters of a WWW-Authenticate: Digest header. */
export function parseDigestChallenge(header: string): DigestChallenge | undefined {
	if (!/^\s*Digest\s/i.test(header)) return undefined
	const params: Record<string, string> = {}
	for (const match of header.matchAll(/(\w+)=(?:"([^"]*)"|([^\s,]+))/g)) {
		params[(match[1] ?? '').toLowerCase()] = match[2] ?? match[3] ?? ''
	}
	if (!params.realm || !params.nonce) return undefined
	return {
		realm: params.realm,
		nonce: params.nonce,
		// A server may offer several, e.g. "auth,auth-int"; only auth is implemented.
		qop: params.qop
			?.split(',')
			.map((q) => q.trim())
			.includes('auth')
			? 'auth'
			: undefined,
		opaque: params.opaque,
		algorithm: params.algorithm,
		count: 0,
	}
}

/** The Authorization header answering a digest challenge for one request. */
export function digestAuthorization(
	challenge: DigestChallenge,
	username: string,
	password: string,
	method: string,
	uri: string,
	cnonce: string = randomBytes(8).toString('hex'),
): string {
	challenge.count++
	const nc = challenge.count.toString(16).padStart(8, '0')
	const ha1 = md5(`${username}:${challenge.realm}:${password}`)
	const ha2 = md5(`${method}:${uri}`)
	const response = challenge.qop
		? md5(`${ha1}:${challenge.nonce}:${nc}:${cnonce}:${challenge.qop}:${ha2}`)
		: md5(`${ha1}:${challenge.nonce}:${ha2}`)

	const parts = [
		`username="${username}"`,
		`realm="${challenge.realm}"`,
		`nonce="${challenge.nonce}"`,
		`uri="${uri}"`,
		`response="${response}"`,
	]
	if (challenge.algorithm) parts.push(`algorithm=${challenge.algorithm}`)
	if (challenge.opaque) parts.push(`opaque="${challenge.opaque}"`)
	if (challenge.qop) parts.push(`qop=${challenge.qop}`, `nc=${nc}`, `cnonce="${cnonce}"`)
	return `Digest ${parts.join(', ')}`
}

/** Lists every service in a TR-064 or IGD description, including those of nested devices. */
export function parseServices(description: string): Tr064Service[] {
	const services: Tr064Service[] = []
	for (const match of description.matchAll(/<service>([\s\S]*?)<\/service>/g)) {
		const block = match[1] ?? ''
		const serviceType = xmlValue(block, 'serviceType')
		const serviceId = xmlValue(block, 'serviceId')
		const controlUrl = xmlValue(block, 'controlURL')
		if (!serviceType || !serviceId || !controlUrl) continue
		services.push({ serviceType, id: serviceId.split(':').pop() ?? serviceId, controlUrl })
	}
	return services
}

/** Reads all New... output arguments of a SOAP response into a plain object. */
export function parseSoapResponse(xml: string): Record<string, string> {
	const result: Record<string, string> = {}
	for (const match of xml.matchAll(/<(New[\w-]+)>([\s\S]*?)<\/\1>/g)) {
		result[match[1] ?? ''] = xmlValue(match[0], match[1] ?? '') ?? ''
	}
	for (const match of xml.matchAll(/<(New[\w-]+)\s*\/>/g)) {
		result[match[1] ?? ''] = ''
	}
	return result
}

export function soapEnvelope(serviceType: string, action: string, args: Record<string, string | number>): string {
	const body = Object.entries(args)
		.map(([key, value]) => `<${key}>${encodeXmlEntities(String(value))}</${key}>`)
		.join('')
	return (
		'<?xml version="1.0" encoding="utf-8"?>' +
		'<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" ' +
		's:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">' +
		`<s:Body><u:${action} xmlns:u="${serviceType}">${body}</u:${action}></s:Body></s:Envelope>`
	)
}

/**
 * A TR-064 client: SOAP over HTTP with digest authentication.
 *
 * The service list is read from tr64desc.xml once and kept, so control URLs are never guessed.
 * The digest nonce is reused with a rising nonce count, which saves the extra 401 round trip the
 * handshake would otherwise cost on every single call; the box sends a fresh challenge whenever it
 * wants a new nonce, and that is answered transparently.
 */
export class Tr064Client {
	readonly #options: Tr064Options
	#services: Tr064Service[] | undefined
	#challenge: DigestChallenge | undefined

	constructor(options: Tr064Options) {
		this.#options = options
	}

	get options(): Tr064Options {
		return this.#options
	}

	/** The services of the box, reading the description the first time. */
	async services(): Promise<Tr064Service[]> {
		if (this.#services) return this.#services
		const path = this.#options.descriptionPath ?? '/tr64desc.xml'
		const res = await this.get(path)
		if (res.status === 404) {
			throw new Error(`The box offers no ${path}. Is "Allow access for applications" switched on?`)
		}
		if (res.status !== 200) throw new Error(`${path} answered HTTP ${res.status}`)
		this.#services = parseServices(res.body)
		return this.#services
	}

	/** The service with this id (e.g. WANCommonInterfaceConfig1), or undefined if the box lacks it. */
	async service(id: string): Promise<Tr064Service | undefined> {
		return (await this.services()).find((service) => service.id === id)
	}

	/** True when the box announces this service. */
	async has(id: string): Promise<boolean> {
		return (await this.service(id)) !== undefined
	}

	/**
	 * A GET on the TR-064 port, used for the description and the list files it hands out.
	 * The prefix is added unless the path already carries it, since list paths the box hands out
	 * over the internet may come with it included. In the home network these files are open, but
	 * over the remote access the box asks for the login even for the description.
	 */
	async get(path: string): Promise<HttpResponse> {
		return this.#send('GET', this.#prefixed(path), {})
	}

	#prefixed(path: string): string {
		const prefix = this.#options.pathPrefix ?? ''
		if (!prefix || path === prefix || path.startsWith(`${prefix}/`)) return path
		return `${prefix}${path.startsWith('/') ? '' : '/'}${path}`
	}

	/** Calls one action of one service and returns its output arguments. */
	async call(
		serviceId: string,
		action: string,
		args: Record<string, string | number> = {},
	): Promise<Record<string, string>> {
		const service = await this.service(serviceId)
		if (!service) throw new Tr064Fault(`${serviceId}#${action}`, 401, `Service ${serviceId} not offered by this box`)
		return this.callService(service, action, args)
	}

	async callService(
		service: Tr064Service,
		action: string,
		args: Record<string, string | number> = {},
	): Promise<Record<string, string>> {
		const body = soapEnvelope(service.serviceType, action, args)
		const res = await this.#send(
			'POST',
			this.#prefixed(service.controlUrl),
			{ 'Content-Type': 'text/xml; charset="utf-8"', SOAPAction: `"${service.serviceType}#${action}"` },
			body,
		)

		if (res.status === 404) {
			// Seen over MyFRITZ!: the box lists X_AVM-DE_Media but its control URL answers 404 there.
			throw new Tr064Fault(`${service.id}#${action}`, 401, 'Not available on this route (HTTP 404)')
		}

		if (res.status === 503) {
			throw new Tr064AuthError('The box is refusing TR-064 logins for now after too many failed attempts')
		}

		if (res.status === 500) {
			const code = Number(xmlValue(res.body, 'errorCode') ?? 0)
			throw new Tr064Fault(`${service.id}#${action}`, code, xmlValue(res.body, 'errorDescription') ?? '')
		}
		if (res.status !== 200) throw new Error(`${service.id}#${action} answered HTTP ${res.status}`)

		return parseSoapResponse(res.body)
	}

	/**
	 * Sends one request, answering a digest challenge when the box asks for one.
	 *
	 * The first request goes out with the nonce of the last one, if any. A 401 means either that
	 * this is the first contact or that the box wants a fresh nonce; one new handshake settles both,
	 * and a second refusal right after it means the credentials are wrong.
	 */
	async #send(
		method: 'GET' | 'POST',
		path: string,
		headers: Record<string, string>,
		body?: string,
	): Promise<HttpResponse> {
		const { host, port, https, timeout, username, password } = this.#options
		const attempt = async (): Promise<HttpResponse> => {
			const withAuth = { ...headers }
			if (this.#challenge)
				withAuth.Authorization = digestAuthorization(this.#challenge, username, password, method, path)
			return httpCall({ host, port, https, method, path, headers: withAuth, body, timeout })
		}

		let res = await attempt()
		if (res.status !== 401) return res

		const header = res.headers['www-authenticate']
		this.#challenge = parseDigestChallenge(Array.isArray(header) ? (header[0] ?? '') : (header ?? ''))
		if (this.#challenge) res = await attempt()
		if (res.status === 401) {
			this.#challenge = undefined
			throw new Tr064AuthError(
				username
					? `TR-064 login as "${username}" refused: wrong user name or password, or no access from the internet for this user`
					: 'TR-064 login refused: the box needs a user name and password',
			)
		}
		return res
	}
}

/** True for the boolean 1/0 TR-064 uses. */
export function tr064Bool(value: string | undefined): boolean {
	return value === '1' || value?.toLowerCase() === 'true'
}

/** A number from a TR-064 field, or undefined when the field is missing or not numeric. */
export function tr064Number(value: string | undefined): number | undefined {
	if (value === undefined || value.trim() === '') return undefined
	const number = Number(value)
	return Number.isFinite(number) ? number : undefined
}
