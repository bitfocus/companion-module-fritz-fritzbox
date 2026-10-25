import { createHash, pbkdf2 } from 'node:crypto'
import { promisify } from 'node:util'
import { httpCall, xmlValue } from './http.js'

const pbkdf2Async = promisify(pbkdf2)

/** The SID the box hands out while nobody is logged in. */
export const NO_SID = '0000000000000000'

/**
 * How long to wait after a refused login before trying again. Every failed attempt makes the box
 * block logins for longer, for the web interface too, so retrying at the poll rate would lock the
 * user out of their own box.
 */
export const LOGIN_RETRY_MS = 60_000

/** Where to reach the web interface of the box. */
export interface WebEndpoint {
	host: string
	port: number
	https: boolean
	timeout: number
}

/** The parts of the login page this module reads. */
export interface SessionInfo {
	sid: string
	challenge: string
	blockTime: number
	/** Right name (NAS, App, HomeAuto, BoxAdmin, Phone, Dial) to access level: 1 read, 2 read and write. */
	rights: Record<string, number>
}

/** The login went through to the box and was refused, which retrying will not change. */
export class LoginRefusedError extends Error {
	readonly blockTime: number

	constructor(message: string, blockTime: number) {
		super(message)
		this.name = 'LoginRefusedError'
		this.blockTime = blockTime
	}
}

export function parseSessionInfo(xml: string): SessionInfo {
	const sid = xmlValue(xml, 'SID')
	if (sid === undefined) throw new Error('The answer of login_sid.lua is not a FRITZ!Box SessionInfo')

	// Rights is a flat run of Name/Access pairs rather than one element per right.
	const rights: Record<string, number> = {}
	const rightsXml = xmlValue(xml, 'Rights') ?? ''
	const pairs = rightsXml.matchAll(/<Name>([^<]*)<\/Name>\s*<Access>(\d+)<\/Access>/g)
	for (const [, name, access] of pairs) {
		if (name) rights[name] = Number(access)
	}

	return {
		sid,
		challenge: xmlValue(xml, 'Challenge') ?? '',
		blockTime: Number(xmlValue(xml, 'BlockTime') ?? 0) || 0,
		rights,
	}
}

/** The answer to a "2$iter1$salt1$iter2$salt2" challenge, used since FRITZ!OS 7.24. */
export async function pbkdf2Response(challenge: string, password: string): Promise<string> {
	const [, iter1, salt1, iter2, salt2] = challenge.split('$')
	if (!iter1 || !salt1 || !iter2 || !salt2) throw new Error(`Unexpected login challenge format: ${challenge}`)

	// Asynchronous on purpose: the iteration counts are in the tens of thousands, which would stall
	// polling and button presses for a noticeable moment if done inline.
	const hash1 = await pbkdf2Async(Buffer.from(password, 'utf8'), Buffer.from(salt1, 'hex'), Number(iter1), 32, 'sha256')
	const hash2 = await pbkdf2Async(hash1, Buffer.from(salt2, 'hex'), Number(iter2), 32, 'sha256')
	return `${salt2}$${hash2.toString('hex')}`
}

/** The answer to an old-style challenge, for boxes that do not offer PBKDF2. */
export function md5Response(challenge: string, password: string): string {
	const text = `${challenge}-${password}`
	const codes: number[] = []
	// Characters beyond Latin-1 are sent as a dot, as the box does when it computes its side.
	for (const char of text) codes.push((char.codePointAt(0) ?? 0) > 255 ? 0x2e : (char.codePointAt(0) ?? 0))
	const bytes = Buffer.alloc(codes.length * 2)
	codes.forEach((code, i) => bytes.writeUInt16LE(code, i * 2))
	return `${challenge}-${createHash('md5').update(bytes).digest('hex')}`
}

export async function challengeResponse(challenge: string, password: string): Promise<string> {
	return challenge.startsWith('2$') ? pbkdf2Response(challenge, password) : md5Response(challenge, password)
}

/**
 * Holds the one web session this connection uses.
 *
 * The box limits how many sessions may be open at once, so the SID is shared by every request and
 * only replaced when the box no longer accepts it. Logins are serialised: several requests that
 * find the SID expired at the same moment wait for the same new one instead of each logging in.
 */
export class FritzSession {
	readonly #endpoint: WebEndpoint
	readonly #username: string
	readonly #password: string
	#sid = NO_SID
	#rights: Record<string, number> = {}
	#pending: Promise<string> | undefined
	/** After a refused login: when the next attempt may be made, and what to say until then. */
	#refused: { until: number; error: LoginRefusedError } | undefined

	constructor(endpoint: WebEndpoint, username: string, password: string) {
		this.#endpoint = endpoint
		this.#username = username
		this.#password = password
	}

	/** The rights of the current session, empty before the first login. */
	get rights(): Record<string, number> {
		return this.#rights
	}

	get loggedIn(): boolean {
		return this.#sid !== NO_SID
	}

	/** The current SID, logging in first if there is none. */
	async sid(): Promise<string> {
		if (this.#sid !== NO_SID) return this.#sid
		return this.#login()
	}

	/** Drops a SID the box has refused, so the next request logs in again. */
	invalidate(rejected: string): void {
		if (this.#sid === rejected) this.#sid = NO_SID
	}

	/** Ends the session on the box, so it does not hold one of its few slots for twenty minutes. */
	async logout(): Promise<void> {
		const sid = this.#sid
		this.#sid = NO_SID
		if (sid === NO_SID) return
		await this.#post(`logout=1&sid=${sid}`).catch(() => undefined)
	}

	async #login(): Promise<string> {
		if (this.#refused && Date.now() < this.#refused.until) throw this.#refused.error
		this.#pending ??= this.#doLogin().finally(() => {
			this.#pending = undefined
		})
		return this.#pending
	}

	async #doLogin(): Promise<string> {
		try {
			const sid = await this.#attemptLogin()
			this.#refused = undefined
			return sid
		} catch (error) {
			if (error instanceof LoginRefusedError) {
				this.#refused = { until: Date.now() + Math.max(LOGIN_RETRY_MS, error.blockTime * 1000), error }
			}
			throw error
		}
	}

	async #attemptLogin(): Promise<string> {
		const page = await httpCall({ ...this.#base(), method: 'GET', path: '/login_sid.lua?version=2' })
		if (page.status === 404) throw new Error('This box has no login_sid.lua, so it is not a FRITZ!Box or far too old')
		if (page.status !== 200) throw new Error(`login_sid.lua answered HTTP ${page.status}`)

		const first = parseSessionInfo(page.body)
		if (first.blockTime > 0) {
			// A login attempt during the block time counts as another failure and extends it.
			throw new LoginRefusedError(
				`The box blocks logins for another ${first.blockTime} s after failed attempts`,
				first.blockTime,
			)
		}

		const response = await challengeResponse(first.challenge, this.#password)
		const form = new URLSearchParams({ username: this.#username, response }).toString()
		const result = await this.#post(form)
		const info = parseSessionInfo(result)

		if (info.sid === NO_SID) {
			throw new LoginRefusedError(
				this.#username
					? `Login as "${this.#username}" refused: wrong user name or password`
					: 'Login refused: the box needs a user name and password',
				info.blockTime,
			)
		}

		this.#sid = info.sid
		this.#rights = info.rights
		return info.sid
	}

	async #post(form: string): Promise<string> {
		const res = await httpCall({
			...this.#base(),
			method: 'POST',
			path: '/login_sid.lua?version=2',
			headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
			body: form,
		})
		if (res.status !== 200) throw new Error(`login_sid.lua answered HTTP ${res.status}`)
		return res.body
	}

	#base(): { host: string; port: number; https: boolean; timeout: number } {
		return { ...this.#endpoint }
	}
}
